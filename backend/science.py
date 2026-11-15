import base64
from dataclasses import dataclass
from io import BytesIO
from math import ceil

import numpy as np
from astropy.coordinates import SkyCoord
from astropy.io import fits
from astropy.stats import SigmaClip
from astropy.visualization import AsinhStretch, ZScaleInterval
from astropy.wcs import WCS
from photutils.background import Background2D, MedianBackground
from photutils.segmentation import detect_sources
from PIL import Image
from reproject import reproject_interp
from scipy.spatial import cKDTree

MAX_PRODUCT_BYTES = 128 * 1024 * 1024
MAX_SOURCES = 300


class ProductError(ValueError):
    pass


@dataclass
class FitsPlane:
    data: np.ndarray
    wcs: WCS
    metadata: dict[str, object]
    hdu_index: int
    hdu_indices: list[int]
    plane_index: int
    plane_count: int


def _celestial_axes(wcs: WCS, dimensions: int) -> tuple[list[int], list[int]]:
    ctype = [str(value).upper() for value in wcs.wcs.ctype]
    if len(ctype) != dimensions:
        raise ProductError("The FITS axis metadata does not match the image dimensions.")
    longitude = next((index for index, value in enumerate(ctype) if value.startswith(("RA", "GLON", "ELON"))), None)
    latitude = next((index for index, value in enumerate(ctype) if value.startswith(("DEC", "GLAT", "ELAT"))), None)
    if longitude is None or latitude is None:
        raise ProductError("This product has no usable celestial WCS axes.")
    return [longitude, latitude], ctype


def read_fits_plane(content: bytes, hdu_choice: int = 0, plane_index: int = 0) -> FitsPlane:
    if not content or len(content) > MAX_PRODUCT_BYTES:
        raise ProductError("The FITS product is empty or exceeds the supported size.")
    try:
        hdul = fits.open(BytesIO(content), memmap=False, do_not_scale_image_data=False)
    except Exception as error:
        raise ProductError("The archive product is not a readable FITS file.") from error

    with hdul:
        candidates: list[tuple[int, fits.hdu.base.ExtensionHDU | fits.PrimaryHDU]] = []
        for index, hdu in enumerate(hdul):
            data = hdu.data
            if data is None or np.ndim(data) < 2:
                continue
            try:
                axis_indices, _ = _celestial_axes(WCS(hdu.header), np.ndim(data))
            except (ProductError, ValueError, TypeError):
                continue
            if len(axis_indices) == 2:
                candidates.append((index, hdu))

        if not candidates:
            raise ProductError("No image plane with celestial coordinates was found in this FITS product.")
        if hdu_choice < 0 or hdu_choice >= len(candidates):
            raise ProductError("The selected FITS image extension is not available.")

        actual_index, hdu = candidates[hdu_choice]
        data = np.asarray(hdu.data, dtype=np.float32)
        full_wcs = WCS(hdu.header)
        spatial_pixel_axes, _ = _celestial_axes(full_wcs, data.ndim)
        spatial_numpy_axes = {data.ndim - 1 - axis for axis in spatial_pixel_axes}
        non_spatial_numpy_axes = [axis for axis in range(data.ndim) if axis not in spatial_numpy_axes]
        varying_axes = [axis for axis in non_spatial_numpy_axes if data.shape[axis] > 1]
        plane_count = int(np.prod([data.shape[axis] for axis in varying_axes], dtype=np.int64)) if varying_axes else 1
        if plane_index < 0 or plane_index >= plane_count:
            raise ProductError("The selected FITS plane is not available.")

        selection: list[int | slice] = [slice(None)] * data.ndim
        if varying_axes:
            plane_coordinates = np.unravel_index(plane_index, tuple(data.shape[axis] for axis in varying_axes))
            for axis, coordinate in zip(varying_axes, plane_coordinates):
                selection[axis] = int(coordinate)
        image = np.squeeze(data[tuple(selection)])
        if image.ndim != 2:
            raise ProductError("The selected product plane is not a two-dimensional celestial image.")

        ctype = [str(value).upper() for value in full_wcs.wcs.ctype]
        wcs = full_wcs.celestial
        row_pixel_axis = data.ndim - 1 - min(spatial_numpy_axes)
        transposed = ctype[row_pixel_axis].startswith(("RA", "GLON", "ELON"))
        if transposed:
            image = image.T
            wcs = wcs.swapaxes(0, 1)
        valid = np.isfinite(image)
        if not np.any(valid):
            raise ProductError("The selected image plane contains no finite pixel values.")
        center = wcs.pixel_to_world((image.shape[1] - 1) / 2, (image.shape[0] - 1) / 2)

        metadata: dict[str, object] = {
            "width": int(image.shape[1]),
            "height": int(image.shape[0]),
            "unit": str(hdu.header.get("BUNIT", "")),
            "observation_id": str(hdu.header.get("OBSID", hdu.header.get("OBS_ID", ""))),
            "created_at": str(hdu.header.get("DATE-OBS", hdu.header.get("DATE", ""))),
            "axis1": str(full_wcs.wcs.ctype[spatial_pixel_axes[0]] or "Longitude"),
            "axis2": str(full_wcs.wcs.ctype[spatial_pixel_axes[1]] or "Latitude"),
            "center_ra": float(center.icrs.ra.deg),
            "center_dec": float(center.icrs.dec.deg),
            "image_count": len(candidates),
            "hdu_index": actual_index,
            "image_hdus": [index for index, _ in candidates],
            "plane_count": plane_count,
            "plane_index": plane_index,
        }
        return FitsPlane(image, wcs, metadata, actual_index, [item[0] for item in candidates], plane_index, plane_count)


def render_png(data: np.ndarray, *, diverging: bool = False, max_dimension: int | None = None) -> bytes:
    finite = data[np.isfinite(data)]
    if finite.size < 1:
        raise ProductError("No valid pixel values are available for image conversion.")
    if diverging:
        limit = float(np.percentile(np.abs(finite), 99.5))
        if not np.isfinite(limit) or limit <= 0:
            limit = float(np.max(np.abs(finite))) or 1.0
        scaled = np.clip(np.nan_to_num(data, nan=0.0) / limit, -1.0, 1.0)
        stretched = np.arcsinh(10.0 * scaled) / np.arcsinh(10.0)
        strength = np.abs(stretched)
        image = np.zeros((*data.shape, 3), dtype=np.uint8)
        positive = stretched >= 0
        image[..., 0] = np.where(positive, 255, 35).astype(np.uint8)
        image[..., 1] = np.where(positive, 255 * (1.0 - strength), 110 * (1.0 - strength)).astype(np.uint8)
        image[..., 2] = np.where(positive, 35, 255).astype(np.uint8)
        image = np.where(np.isfinite(data)[..., None], image, 18).astype(np.uint8)
        pil_image = Image.fromarray(image, mode="RGB")
    else:
        sample_stride = max(1, ceil(finite.size / 500_000))
        sample = finite[::sample_stride]
        try:
            low, high = ZScaleInterval(contrast=0.25).get_limits(sample)
        except (ValueError, IndexError):
            low, high = np.percentile(sample, (1.0, 99.5))
        if not np.isfinite(low) or not np.isfinite(high) or high <= low:
            low, high = np.percentile(sample, (1.0, 99.5))
        if not np.isfinite(high) or high <= low:
            raise ProductError("The image has no useful intensity range to display.")
        normalized = np.clip((np.nan_to_num(data, nan=low, posinf=high, neginf=low) - low) / (high - low), 0.0, 1.0)
        stretched = AsinhStretch(a=0.1)(normalized)
        image = np.round(stretched * 255).astype(np.uint8)
        pil_image = Image.fromarray(image, mode="L")

    if max_dimension is not None:
        pil_image.thumbnail((max_dimension, max_dimension), Image.Resampling.LANCZOS)

    output = BytesIO()
    pil_image.save(output, format="PNG", optimize=True)
    return output.getvalue()


def _detect_sources(data: np.ndarray, valid: np.ndarray, wcs: WCS, x_offset: int, y_offset: int) -> list[dict[str, object]]:
    masked = np.ma.array(data, mask=~valid | ~np.isfinite(data))
    try:
        background = Background2D(
            masked,
            box_size=(64, 64),
            filter_size=(3, 3),
            sigma_clip=SigmaClip(sigma=3.0),
            bkg_estimator=MedianBackground(),
            exclude_percentile=50,
        )
    except (ValueError, IndexError) as error:
        raise ProductError("Background and noise could not be estimated for this image.") from error

    residual = np.asarray(data, dtype=np.float32) - background.background
    rms = np.asarray(background.background_rms, dtype=np.float32)
    valid_noise = valid & np.isfinite(rms) & (rms > 0)
    if not np.any(valid_noise):
        raise ProductError("The image has no reliable background-noise estimate.")
    threshold = np.where(valid_noise, 5.0 * rms, np.inf)
    segmentation = detect_sources(residual, threshold, npixels=5, mask=~valid_noise, connectivity=8)
    if segmentation is None:
        return []

    labels = segmentation.data
    flat_labels = labels.ravel()
    label_count = int(flat_labels.max()) + 1
    counts = np.bincount(flat_labels, minlength=label_count)
    yy, xx = np.indices(labels.shape, dtype=np.float64)
    residual_flat = np.nan_to_num(residual, nan=0.0).ravel()
    rms_flat = np.nan_to_num(rms, nan=0.0).ravel()
    positive = np.maximum(residual_flat, 0.0)
    weights = np.bincount(flat_labels, weights=positive, minlength=label_count)
    x_sums = np.bincount(flat_labels, weights=positive * xx.ravel(), minlength=label_count)
    y_sums = np.bincount(flat_labels, weights=positive * yy.ravel(), minlength=label_count)
    fluxes = np.bincount(flat_labels, weights=residual_flat, minlength=label_count)
    noise_variances = np.bincount(flat_labels, weights=np.square(rms_flat), minlength=label_count)
    candidate_labels = np.flatnonzero(counts[1:] >= 5) + 1
    candidate_labels = candidate_labels[(weights[candidate_labels] > 0) & (noise_variances[candidate_labels] > 0)]
    source_fluxes = fluxes[candidate_labels]
    noises = np.sqrt(noise_variances[candidate_labels])
    snrs = source_fluxes / noises
    keep = np.isfinite(snrs) & (snrs >= 5.0)
    candidate_labels = candidate_labels[keep]
    source_fluxes = source_fluxes[keep]
    noises = noises[keep]
    snrs = snrs[keep]
    xs = x_sums[candidate_labels] / weights[candidate_labels] + x_offset
    ys = y_sums[candidate_labels] / weights[candidate_labels] + y_offset
    sky = wcs.pixel_to_world(xs, ys)
    if not isinstance(sky, SkyCoord):
        raise ProductError("Celestial coordinates could not be calculated for detected sources.")
    candidates = [{
        "x": float(x),
        "y": float(y),
        "ra": float(ra),
        "dec": float(dec),
        "flux": float(flux),
        "flux_error": float(noise),
        "snr": float(snr),
        "area_pixels": int(counts[label]),
    } for x, y, ra, dec, flux, noise, snr, label in zip(
        xs, ys, sky.icrs.ra.deg, sky.icrs.dec.deg, source_fluxes, noises, snrs, candidate_labels
    )]
    candidates.sort(key=lambda item: float(item["snr"]), reverse=True)
    return candidates


def analyze_pair(
    earlier_bytes: bytes,
    later_bytes: bytes,
    *,
    earlier_date: str,
    later_date: str,
    earlier_band: str,
    later_band: str,
    earlier_hdu: int = 0,
    later_hdu: int = 0,
    earlier_plane: int = 0,
    later_plane: int = 0,
) -> dict[str, object]:
    try:
        old_mjd = float(earlier_date)
        new_mjd = float(later_date)
    except (TypeError, ValueError) as error:
        raise ProductError("Both observations must have valid archive observation times.") from error
    if new_mjd <= old_mjd:
        raise ProductError("Choose observations from different times, with the later observation second.")
    if not earlier_band or earlier_band != later_band:
        raise ProductError("These products do not have matching SPHEREx wavelength-band identifiers.")

    earlier = read_fits_plane(earlier_bytes, earlier_hdu, earlier_plane)
    later = read_fits_plane(later_bytes, later_hdu, later_plane)
    if earlier.metadata["unit"] != later.metadata["unit"]:
        raise ProductError("These products use different image units and cannot be compared directly.")

    from astropy.wcs.utils import proj_plane_pixel_scales

    old_scales = np.abs(proj_plane_pixel_scales(earlier.wcs)) * 3600.0
    new_scales = np.abs(proj_plane_pixel_scales(later.wcs)) * 3600.0
    if old_scales.size != 2 or new_scales.size != 2 or np.any(old_scales <= 0):
        raise ProductError("The celestial pixel scales are missing or invalid.")
    scale_delta = np.abs(new_scales - old_scales) / old_scales
    if np.any(scale_delta > 0.02):
        raise ProductError("These products have incompatible spatial pixel scales.")

    aligned, footprint = reproject_interp(
        (later.data, later.wcs),
        earlier.wcs,
        shape_out=earlier.data.shape,
        order="bilinear",
        return_footprint=True,
    )
    valid = np.isfinite(earlier.data) & np.isfinite(aligned) & (footprint >= 0.99)
    if int(valid.sum()) < 10_000:
        raise ProductError("The observations do not share enough valid sky area for source comparison.")
    yy, xx = np.nonzero(valid)
    x0, x1 = int(xx.min()), int(xx.max()) + 1
    y0, y1 = int(yy.min()), int(yy.max()) + 1
    old_data = earlier.data[y0:y1, x0:x1]
    new_data = aligned[y0:y1, x0:x1]
    common = valid[y0:y1, x0:x1]
    crop_wcs = earlier.wcs.slice((slice(y0, y1), slice(x0, x1)))
    old_sources = _detect_sources(old_data, common, crop_wcs, 0, 0)
    new_sources = _detect_sources(new_data, common, crop_wcs, 0, 0)

    matches: list[tuple[int, int, float]] = []
    possible_matches: list[tuple[float, int, int]] = []
    if old_sources and new_sources:
        new_positions = np.array([[source["x"], source["y"]] for source in new_sources], dtype=np.float64)
        old_positions = np.array([[source["x"], source["y"]] for source in old_sources], dtype=np.float64)
        neighbors = cKDTree(new_positions).query_ball_point(old_positions, r=2.0)
        for old_index, new_indices in enumerate(neighbors):
            for new_index in new_indices:
                separation = float(np.linalg.norm(old_positions[old_index] - new_positions[new_index]))
                possible_matches.append((separation, old_index, new_index))
    used_old: set[int] = set()
    used_new: set[int] = set()
    for separation, old_index, new_index in sorted(possible_matches):
        if old_index not in used_old and new_index not in used_new:
            matches.append((old_index, new_index, separation))
            used_old.add(old_index)
            used_new.add(new_index)

    objects: list[dict[str, object]] = []
    for old_index, new_index, separation in matches:
        old_source, new_source = old_sources[old_index], new_sources[new_index]
        delta = float(new_source["flux"]) - float(old_source["flux"])
        combined_error = float(np.hypot(float(new_source["flux_error"]), float(old_source["flux_error"])))
        significance = abs(delta) / combined_error if combined_error > 0 else 0.0
        fractional_change = delta / float(old_source["flux"]) if float(old_source["flux"]) != 0 else 0.0
        brightness_candidate = significance >= 5.0 and abs(fractional_change) >= 0.2
        pixel_scale = float(np.mean(old_scales))
        position_error_pixels = float(np.hypot(
            0.5 / max(float(old_source["snr"]), 1.0),
            0.5 / max(float(new_source["snr"]), 1.0),
        ))
        position_offset = separation * pixel_scale
        position_candidate = (
            min(float(old_source["snr"]), float(new_source["snr"])) >= 10
            and position_offset > max(3 * position_error_pixels * pixel_scale, 0.5 * pixel_scale)
        )
        status = "position_candidate" if position_candidate else "brightness_candidate" if brightness_candidate else "common"
        objects.append({
            "status": status,
            "brightness_candidate": brightness_candidate,
            "position_candidate": position_candidate,
            "earlier": old_source,
            "later": new_source,
            "brightness_delta": delta,
            "brightness_percent": fractional_change * 100.0,
            "brightness_significance": significance,
            "position_delta_pixels": separation,
            "position_delta_arcsec": position_offset,
        })
    for index, source in enumerate(old_sources):
        if index not in used_old:
            objects.append({"status": "not_detected_later", "earlier": source, "later": None})
    for index, source in enumerate(new_sources):
        if index not in used_new:
            objects.append({"status": "new_candidate", "earlier": None, "later": source})

    objects.sort(key=lambda item: (
        float((item.get("earlier") or item.get("later") or {}).get("y", 0)),
        float((item.get("earlier") or item.get("later") or {}).get("x", 0)),
    ))
    for index, item in enumerate(objects, start=1):
        item["id"] = f"SRC-{index:03d}"
        item["object_type"] = "unclassified_source"

    difference = np.where(common, new_data - old_data, np.nan).astype(np.float32)
    old_png = render_png(np.where(common, old_data, np.nan))
    new_png = render_png(np.where(common, new_data, np.nan))
    difference_png = render_png(difference, diverging=True)
    pixel_scale = float(np.mean(old_scales))
    return {
        "earlier": {**earlier.metadata, "date_mjd": old_mjd, "band": earlier_band, "pixel_scale_arcsec": pixel_scale},
        "later": {**later.metadata, "date_mjd": new_mjd, "band": later_band, "pixel_scale_arcsec": pixel_scale},
        "comparison": {
            "width": int(old_data.shape[1]),
            "height": int(old_data.shape[0]),
            "overlap_pixels": int(common.sum()),
            "localization": [x0, y0],
        },
        "sources": objects[:MAX_SOURCES],
        "source_list_truncated": len(objects) > MAX_SOURCES,
        "displayed_source_limit": MAX_SOURCES,
        "summary": {
            "earlier_detected": len(old_sources),
            "later_detected": len(new_sources),
            "common": len(matches),
            "new_candidates": sum(item["status"] == "new_candidate" for item in objects),
            "not_detected_later": sum(item["status"] == "not_detected_later" for item in objects),
            "brightness_candidates": sum(bool(item.get("brightness_candidate")) for item in objects),
            "position_candidates": sum(bool(item.get("position_candidate")) for item in objects),
        },
        "quality_note": "Exploratory image analysis only: PSF matching, archive quality masks, absolute calibration uncertainties, and catalogue cross-identification are not applied.",
        "images": {
            "earlier_png": base64.b64encode(old_png).decode("ascii"),
            "later_png": base64.b64encode(new_png).decode("ascii"),
            "difference_png": base64.b64encode(difference_png).decode("ascii"),
        },
    }
