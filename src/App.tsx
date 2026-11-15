import { useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Activity, ArrowLeftRight, ArrowUpRight, BadgeCheck, BookOpen, Check, ChevronLeft, ChevronRight, CircleHelp,
  Clock3, Compass, Download, ExternalLink, Expand, FileText, Focus, Globe2, Image, Info, Languages, Layers,
  Menu, MoveHorizontal, Orbit, Radio, RotateCcw, Search, ShieldAlert, Sparkles, Telescope, Waves, X,
} from 'lucide-react'
import {
  archiveIdSearchUrl, archiveSearchUrl, formatObservationDate, formatObservationTimestamp, IRSA_DOCS, IRSA_EXPLORER, observationDateKey, observationTimeValue,
  resolveCollections, searchSpherex, searchSpherexById, type CollectionMode, type Observation,
} from './services/irsa'
import { searchNasaImages, type NasaImage } from './services/nasa'
import { apiUrl } from './services/api'
import {
  productComparisonProxyUrl, productDownloadProxyUrl, productPngProxyUrl, productThumbnailProxyUrl,
  type FitsComparison, type FitsImage,
} from './services/fits'
import { languageOptions } from './i18n'

type Page = 'home' | 'explorer' | 'time-machine' | 'spectrum' | 'detector' | 'reports' | 'learn' | 'about'
type ImageGroup = { label: string; query: string; image?: NasaImage }
type ComparisonEvidence = {
  result: FitsComparison
  ra: number
  dec: number
  earlierDate: string
  laterDate: string
}
type OpenProductState = { observation: Observation; observations: Observation[] }

const navigation: { id: Page; labelKey: string; icon: typeof Orbit }[] = [
  { id: 'home', labelKey: 'nav.home', icon: Orbit },
  { id: 'explorer', labelKey: 'nav.explorer', icon: Compass },
  { id: 'time-machine', labelKey: 'nav.timeMachine', icon: Clock3 },
  { id: 'spectrum', labelKey: 'nav.spectrum', icon: Waves },
  { id: 'detector', labelKey: 'nav.detector', icon: Activity },
  { id: 'reports', labelKey: 'nav.reports', icon: FileText },
  { id: 'learn', labelKey: 'nav.learn', icon: BookOpen },
  { id: 'about', labelKey: 'nav.about', icon: CircleHelp },
]

const nominalBands = [
  { label: '0.75–1.1 μm', color: '#8879ff' },
  { label: '1.1–1.6 μm', color: '#a77cff' },
  { label: '1.6–2.4 μm', color: '#578cff' },
  { label: '2.4–3.8 μm', color: '#43b8ff' },
  { label: '3.8–4.4 μm', color: '#57dfda' },
  { label: '4.4–5.0 μm', color: '#82efca' },
]

function isPage(value: string): value is Page {
  return navigation.some((item) => item.id === value)
}

function usePage() {
  const [page, setPage] = useState<Page>(() => {
    const hash = window.location.hash.slice(1)
    return isPage(hash) ? hash : 'home'
  })
  useEffect(() => {
    const readHash = () => {
      const hash = window.location.hash.slice(1)
      setPage(isPage(hash) ? hash : 'home')
    }
    window.addEventListener('hashchange', readHash)
    return () => window.removeEventListener('hashchange', readHash)
  }, [])
  return page
}

function App() {
  const { t, i18n } = useTranslation()
  const page = usePage()
  const [menuOpen, setMenuOpen] = useState(false)
  const [splashVisible, setSplashVisible] = useState(true)
  const [openedProduct, setOpenedProduct] = useState<OpenProductState | null>(null)
  const [comparisonPosition, setComparisonPosition] = useState<{ ra: string; dec: string } | null>(null)
  const [comparisonEvidence, setComparisonEvidence] = useState<ComparisonEvidence | null>(null)
  const [groups, setGroups] = useState<ImageGroup[]>([
    { label: 'Infrared galaxies', query: 'NASA infrared galaxy' },
    { label: 'Nebulae in visible light', query: 'NASA nebula Hubble' },
    { label: 'Deep space', query: 'NASA deep field galaxy' },
    { label: 'Star-forming regions', query: 'NASA star formation nebula' },
  ])
  const [heroImage, setHeroImage] = useState<NasaImage>()
  const openProduct = (observation: Observation, observations: Observation[] = [observation]) => {
    setOpenedProduct({ observation, observations })
  }

  useEffect(() => {
    const timer = window.setTimeout(() => setSplashVisible(false), 1000)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    document.title = 'COSMIC LENS — SPHEREx Universe Explorer'
    document.documentElement.lang = i18n.resolvedLanguage ?? 'en'
  }, [i18n.resolvedLanguage])

  useEffect(() => {
    const controller = new AbortController()
    void searchNasaImages('NASA SPHEREx nebula infrared', controller.signal)
      .then((images) => setHeroImage(images[0]))
      .catch(() => undefined)
    void Promise.all(groups.map(async (group) => {
      try {
        const [image] = await searchNasaImages(group.query, controller.signal)
        return { ...group, image }
      } catch {
        return group
      }
    })).then(setGroups)
    return () => controller.abort()
    // Load the four illustrative NASA reference image searches once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const navigate = (id: Page) => {
    window.location.hash = id
    setMenuOpen(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const active = navigation.find((item) => item.id === page)

  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
        <a className="brand" href="#home" onClick={() => setMenuOpen(false)}>
          <span className="brand-mark"><img src="/cosmic-games-logo.png" alt="" /></span>
          <span><strong>COSMIC LENS</strong><small>SPHEREx · {t('nav.explorer')}</small></span>
        </a>
        <div className="sidebar-label">{t('nav.section')}</div>
        <nav className="main-nav" aria-label={t('nav.workspace')}>
          {navigation.map(({ id, labelKey, icon: Icon }) => (
            <a key={id} href={`#${id}`} onClick={() => setMenuOpen(false)}
              className={`nav-link ${page === id ? 'nav-active' : ''}`}>
              <Icon size={17} strokeWidth={1.7} /><span>{t(labelKey)}</span>
              {page === id && <span className="nav-indicator" />}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="mission-card">
            <div className="mission-icon"><Radio size={16} /></div>
            <div><strong>{t('nav.missionStatus')}</strong><span>{t('nav.archiveConnected')}</span></div>
            <i className="live-dot" />
          </div>
          <a className="archive-link" href={IRSA_EXPLORER} target="_blank" rel="noreferrer">
            <ExternalLink size={14} /> {t('nav.openArchive')}
          </a>
          <div className="sidebar-copyright">NASA / IPAC {t('nav.publicArchive')}<br />{t('nav.independent')}</div>
        </div>
      </aside>

      {menuOpen && <button className="mobile-backdrop" aria-label={t('nav.closeMenu')} onClick={() => setMenuOpen(false)} />}
      <main className="main-area">
        <header className="topbar">
          <button className="mobile-menu icon-button" aria-label={t('nav.openMenu')} onClick={() => setMenuOpen(true)}><Menu size={19} /></button>
          <div className="breadcrumbs"><span>{t('nav.workspace')}</span><span className="crumb-slash">/</span><b>{active ? t(active.labelKey) : ''}</b></div>
          <div className="topbar-right">
            <span className="archive-status"><span className="live-dot" /> {t('nav.publicArchive')}</span>
            <label className="language-control">
              <Languages size={15} aria-hidden="true" />
              <span className="language-label">{t('language.label')}</span>
              <select aria-label={t('language.select')} value={i18n.resolvedLanguage ?? 'en'}
                onChange={(event) => { void i18n.changeLanguage(event.target.value) }}>
                {languageOptions.map(({ code, label }) => <option key={code} value={code}>{label}</option>)}
              </select>
            </label>
            <a className="topbar-round" href="https://irsa.ipac.caltech.edu/Missions/spherex.html" aria-label={t('nav.archiveLabel')} target="_blank" rel="noreferrer"><Globe2 size={17} /></a>
          </div>
        </header>
        <div className="page-content">
          {page === 'home' && <HomePage navigate={navigate} heroImage={heroImage} groups={groups} />}
          {page === 'explorer' && <SkyExplorer onOpenProduct={openProduct} onCompareAt={(ra, dec) => { setComparisonPosition({ ra, dec }); navigate('time-machine') }} />}
          {page === 'time-machine' && <TimeMachine initialPosition={comparisonPosition} navigate={navigate} onComparisonChange={setComparisonEvidence} onOpenProduct={openProduct} />}
          {page === 'spectrum' && <SpectrumViewer />}
          {page === 'detector' && <ChangeDetector onOpenProduct={openProduct} onCompareAt={(nextRa, nextDec) => { setComparisonPosition({ ra: nextRa, dec: nextDec }); navigate('time-machine') }} />}
          {page === 'reports' && <Reports evidence={comparisonEvidence} navigate={navigate} />}
          {page === 'learn' && <LearnPage groups={groups} />}
          {page === 'about' && <AboutPage />}
        </div>
      </main>
      {openedProduct && <FitsProductViewer
        observation={openedProduct.observation}
        navigation={openedProduct.observations}
        onNavigate={(observation) => setOpenedProduct((current) => current ? { ...current, observation } : null)}
        onClose={() => setOpenedProduct(null)}
      />}
      {splashVisible && <SplashScreen />}
    </div>
  )
}

function SplashScreen() {
  return (
    <div className="splash-screen" role="status" aria-label="COSMIC LENS">
      <img src="/cosmic-games-logo.png" alt="COSMIC LENS" />
      <strong>COSMIC LENS</strong>
      <span className="splash-loader"><i /><i /><i /></span>
    </div>
  )
}

function FitsProductViewer({ observation, onClose, compact = false, preservePrevious = false, navigation, onNavigate }: {
  observation: Observation
  onClose?: () => void
  compact?: boolean
  preservePrevious?: boolean
  navigation?: Observation[]
  onNavigate?: (observation: Observation) => void
}) {
  const { t } = useTranslation()
  const viewerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ x: number; y: number } | null>(null)
  const imageUrlRef = useRef('')
  const imageUrlsRef = useRef<Set<string>>(new Set())
  const [image, setImage] = useState<FitsImage | null>(null)
  const [imageUrl, setImageUrl] = useState('')
  const [previousImageUrl, setPreviousImageUrl] = useState('')
  const [displayedObservation, setDisplayedObservation] = useState<Observation | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [hduChoice, setHduChoice] = useState(0)
  const [plane, setPlane] = useState(0)
  const navigationIndex = navigation?.findIndex((item) => (
    item.accessUrl === observation.accessUrl && item.previewUrl === observation.previewUrl
  )) ?? -1

  useEffect(() => () => {
    for (const url of imageUrlsRef.current) URL.revokeObjectURL(url)
    imageUrlsRef.current.clear()
    imageUrlRef.current = ''
  }, [])

  useEffect(() => {
    let active = true
    let objectUrl = ''
    let timeoutId = 0
    const controller = new AbortController()
    if (!preservePrevious) {
      const previousUrl = imageUrlRef.current
      imageUrlRef.current = ''
      if (previousUrl) {
        URL.revokeObjectURL(previousUrl)
        imageUrlsRef.current.delete(previousUrl)
      }
      setImage(null); setImageUrl(''); setPreviousImageUrl(''); setDisplayedObservation(null)
    }
    if (!observation.accessUrl) {
      setImage(null)
      setImageUrl(observation.previewUrl)
      setDisplayedObservation(observation)
      setBusy(false)
      setError(observation.previewUrl ? '' : 'fits.productUnavailable')
      return () => { active = false }
    }
    setBusy(true); setError(''); setZoom(1); setPan({ x: 0, y: 0 })
    timeoutId = window.setTimeout(() => {
      if (active) {
        setError('fits.productUnavailable')
        controller.abort()
      }
    }, 90000)
    void (async () => {
      try {
        const response = await fetch(apiUrl(productPngProxyUrl(observation.accessUrl, hduChoice, plane)), { signal: controller.signal })
        if (!response.ok) throw new Error(response.status === 413 ? 'fits.imageTooLarge' : 'fits.productUnavailable')
        const encodedMetadata = response.headers.get('X-Fits-Metadata')
        if (!encodedMetadata) throw new Error('fits.metadataUnavailable')
        const metadataBytes = Uint8Array.from(atob(encodedMetadata), (value) => value.charCodeAt(0))
        const metadata = JSON.parse(new TextDecoder().decode(metadataBytes)) as FitsImage
        objectUrl = URL.createObjectURL(await response.blob())
        if (!active) {
          URL.revokeObjectURL(objectUrl)
          objectUrl = ''
          return
        }
        const previousUrl = imageUrlRef.current
        imageUrlRef.current = objectUrl
        imageUrlsRef.current.add(objectUrl)
        setImage(metadata); setImageUrl(objectUrl); setDisplayedObservation(observation)
        objectUrl = ''
        if (preservePrevious && previousUrl && previousUrl !== imageUrlRef.current) {
          setPreviousImageUrl(previousUrl)
          window.setTimeout(() => {
            setPreviousImageUrl((current) => current === previousUrl ? '' : current)
            if (imageUrlRef.current !== previousUrl) {
              URL.revokeObjectURL(previousUrl)
              imageUrlsRef.current.delete(previousUrl)
            }
          }, 450)
        }
      } catch (reason) {
        if (!active || controller.signal.aborted) return
        console.error('SPHEREx FITS product could not be converted to PNG:', reason)
        if (active) setError(reason instanceof Error && reason.message === 'fits.imageTooLarge'
          ? reason.message : 'fits.productUnavailable')
      } finally {
        if (active) setBusy(false)
      }
    })()
    return () => {
      active = false
      window.clearTimeout(timeoutId)
      controller.abort()
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
        imageUrlsRef.current.delete(objectUrl)
      }
    }
  }, [observation.accessUrl, observation.previewUrl, observation.date, observation.raw.obs_id, hduChoice, plane, preservePrevious])

  useEffect(() => {
    const viewport = viewerRef.current?.querySelector('.fits-viewport')
    if (!(viewport instanceof HTMLDivElement)) return
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault()
      setZoom((value) => Math.max(1, Math.min(8, value * (event.deltaY < 0 ? 1.12 : 1 / 1.12))))
    }
    viewport.addEventListener('wheel', handleWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', handleWheel)
  }, [])

  const startPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (zoom <= 1) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { x: event.clientX - pan.x, y: event.clientY - pan.y }
  }
  const movePan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    setPan({ x: event.clientX - dragRef.current.x, y: event.clientY - dragRef.current.y })
  }
  const stopPan = () => { dragRef.current = null }
  const reset = () => { setZoom(1); setPan({ x: 0, y: 0 }) }
  const errorText = error ? t(error) : ''
  const shownObservation = displayedObservation ?? observation
  const observationId = archiveField(shownObservation, 'obs_id', 'obs_publisher_did')
  const targetName = shownObservation.target || archiveField(shownObservation, 'target_name') || t('explorer.observation')
  const facility = archiveField(shownObservation, 'facility_name', 'facility')
  const instrument = archiveField(shownObservation, 'instrument_name', 'instrument')
  const hasCoordinates = shownObservation.ra !== '' || shownObservation.dec !== ''

  return (
    <div className={compact ? 'fits-inline' : 'fits-modal-backdrop'} role={compact ? undefined : 'presentation'}>
      <section className={`fits-viewer ${compact ? 'fits-viewer-compact' : ''}`} role={compact ? undefined : 'dialog'} aria-modal={compact ? undefined : true} aria-label={t('fits.title')} ref={viewerRef}>
        <div className="fits-viewer-head">
          <div><div className="eyebrow">{t('fits.source')}</div><h2>{observationId || targetName || t('fits.product')}</h2></div>
          <div className="fits-toolbar">
            {navigation && onNavigate && navigation.length > 1 && <button type="button" className="icon-button" onClick={() => { if (navigationIndex > 0) onNavigate(navigation[navigationIndex - 1]) }} disabled={navigationIndex <= 0} aria-label={t('fits.previousImage')}><ChevronLeft size={16} /></button>}
            {navigation && navigationIndex >= 0 && <span className="fits-image-count">{t('fits.imageCount', { current: navigationIndex + 1, total: navigation.length })}</span>}
            {navigation && onNavigate && navigation.length > 1 && <button type="button" className="icon-button" onClick={() => { if (navigationIndex >= 0 && navigationIndex < navigation.length - 1) onNavigate(navigation[navigationIndex + 1]) }} disabled={navigationIndex < 0 || navigationIndex >= navigation.length - 1} aria-label={t('fits.nextImage')}><ChevronRight size={16} /></button>}
            <button type="button" className="icon-button" onClick={() => setZoom((value) => Math.min(8, value * 1.25))} aria-label={t('fits.zoomIn')}><span>+</span></button>
            <button type="button" className="icon-button" onClick={() => setZoom((value) => Math.max(1, value / 1.25))} aria-label={t('fits.zoomOut')}><span>−</span></button>
            <button type="button" className="icon-button" onClick={reset} aria-label={t('fits.reset')}><RotateCcw size={15} /></button>
            <button type="button" className="icon-button" onClick={() => void viewerRef.current?.requestFullscreen()} aria-label={t('fits.fullscreen')}><Expand size={15} /></button>
            {!compact && onClose && <button type="button" className="icon-button" onClick={onClose} aria-label={t('fits.close')}><X size={16} /></button>}
          </div>
        </div>
        <div className="fits-download-row">
          {imageUrl && image && <a className="button-secondary" href={imageUrl} download={`${(image.observation_id || 'spherex-image').replace(/[^a-zA-Z0-9._-]/g, '_')}.png`}><Download size={14} />{t('fits.downloadPng')}</a>}
          {shownObservation.accessUrl && <a className="button-secondary" href={productDownloadProxyUrl(shownObservation.accessUrl)}><Download size={14} />{t('fits.download')}</a>}
        </div>
        <div className="fits-product-meta">
          <span>{t('fits.observation')}: {formatObservationDate(shownObservation.date) || t('fits.notAvailable')}</span>
          {observationId && <span>{t('fits.id')}: {observationId}</span>}
          {shownObservation.target && <span>{t('explorer.target')}: {shownObservation.target}</span>}
          {facility && <span>{t('fits.facility')}: {facility}</span>}
          {instrument && <span>{t('fits.instrument')}: {instrument}</span>}
          {hasCoordinates && <span>{t('fits.coordinates')}: {shownObservation.ra || t('fits.notAvailable')}°, {shownObservation.dec || t('fits.notAvailable')}°</span>}
          {shownObservation.wavelengthMin !== null && shownObservation.wavelengthMax !== null && <span>{t('fits.wavelength')}: {(shownObservation.wavelengthMin * 1e6).toFixed(2)}–{(shownObservation.wavelengthMax * 1e6).toFixed(2)} μm</span>}
          {image && (
            <>
              <span>{image.width} × {image.height} px</span><span>{image.unit || t('fits.unitUnavailable')}</span>
              <span>{t('fits.coordinates')}: {image.center_ra.toFixed(5)}°, {image.center_dec.toFixed(5)}°</span>
              {image.observation_id && <span>{t('fits.id')}: {image.observation_id}</span>}
              {image.created_at && <span>{t('fits.created')}: {image.created_at}</span>}
            </>
          )}
        </div>
        {image && image.image_count > 1 && <label className="fits-plane-select">{t('fits.extension')}<select value={hduChoice} onChange={(event) => { setHduChoice(Number(event.target.value)); setPlane(0) }}>{Array.from({ length: image.image_count }, (_, index) => <option key={index} value={index}>{t('fits.extensionOption', { number: index + 1 })}</option>)}</select></label>}
        {image && image.plane_count > 1 && <label className="fits-plane-select">{t('fits.plane')}<select value={plane} onChange={(event) => setPlane(Number(event.target.value))}>{Array.from({ length: image.plane_count }, (_, index) => <option key={index} value={index}>{t('fits.planeOption', { number: index + 1 })}</option>)}</select></label>}
        <div className={`fits-viewport ${preservePrevious ? 'fits-viewport-transition' : ''} ${busy && preservePrevious && imageUrl ? 'fits-viewport-loading-next' : ''}`} onPointerDown={startPan} onPointerMove={movePan} onPointerUp={stopPan} onPointerCancel={stopPan}>
          {preservePrevious ? <div className="fits-canvas-stack">
            {previousImageUrl && <img key={`previous-${previousImageUrl}`} src={previousImageUrl} className="fits-canvas fits-canvas-previous" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }} alt="" aria-hidden="true" />}
            {imageUrl && <img key={imageUrl} src={imageUrl} className="fits-canvas fits-canvas-current" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }} alt={t('fits.imageAlt')} onError={() => { setError('fits.productUnavailable'); setBusy(false) }} />}
          </div> : imageUrl && <img src={imageUrl} className="fits-canvas" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }} alt={t('fits.imageAlt')} onError={() => { setError('fits.productUnavailable'); setBusy(false) }} />}
          {busy && (!preservePrevious || !imageUrl) && <div className="loading-state"><span className="spinner" />{t('fits.loading')}</div>}
          {busy && preservePrevious && imageUrl && <div className="fits-transition-status" role="status"><span className="spinner" />{t('fits.loading')}</div>}
          {!busy && error && preservePrevious && imageUrl && <div className="fits-transition-error" role="status"><b>{t('fits.errorTitle')}</b><span>{errorText}</span></div>}
          {!busy && error && (!preservePrevious || !imageUrl) && <div className="empty-state"><Image size={20} /><b>{t('fits.errorTitle')}</b><span>{errorText}</span></div>}
        </div>
        {!shownObservation.accessUrl && shownObservation.previewUrl && <p className="fits-preview-only">{t('fits.previewOnly')}</p>}
        {image && <div className="fits-viewer-foot"><span>{t('fits.staticImage')} · {t('fits.axis')}: {image.axis1} × {image.axis2}</span><span>{t('fits.zoom')}: {Math.round(zoom * 100)}%</span></div>}
      </section>
    </div>
  )
}

function PageIntro({ eyebrow, title, description, icon: Icon }: {
  eyebrow: string; title: string; description: string; icon: typeof Orbit
}) {
  return (
    <div className="page-intro">
      <div>
        <div className="eyebrow"><Icon size={13} /> {eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <span className="page-intro-mark"><Icon size={21} /></span>
    </div>
  )
}

function HomePage({ navigate, heroImage, groups }: {
  navigate: (page: Page) => void; heroImage?: NasaImage; groups: ImageGroup[]
}) {
  const { t } = useTranslation()
  const [heroFailed, setHeroFailed] = useState(false)
  return (
    <div className="home-page">
      <section className="hero-panel">
        <div className="hero-art" style={heroImage && !heroFailed ? { backgroundImage: `url("${heroImage.imageUrl}")` } : undefined}>
          <div className="hero-shade" />
          <div className="hero-top"><span className="pill"><span className="live-dot" /> {t('home.missionPublic')}</span><span className="hero-coordinate">{t('home.allSky')} <span>·</span> 0.75–5 μm</span></div>
          {heroImage && <img className="visually-hidden-image" src={heroImage.imageUrl} alt="" onError={() => setHeroFailed(true)} />}
          <div className="hero-copy">
            <div className="hero-kicker"><span className="tiny-star">✳</span> {t('home.kicker')}</div>
            <h1>{t('home.heroTitle')}<br /><span>{t('home.heroTitle2')}</span></h1>
            <p>{t('home.heroDescription')}</p>
            <button className="button-primary" onClick={() => navigate('explorer')}>{t('home.explore')} <ArrowUpRight size={16} /></button>
          </div>
          <div className="hero-image-caption"><span className="caption-dot" />{heroImage ? t('home.imageCaption', { title: heroImage.title }) : t('home.illustrationCaption')}<span className="caption-right">{t('home.sees')}</span></div>
          <div className="hero-decor"><div className="orbit-ring orbit-one" /><div className="orbit-ring orbit-two" /><div className="orbit-planet" /></div>
        </div>
      </section>

      <div className="intro-row">
        <div>
          <div className="eyebrow"><Sparkles size={13} /> {t('home.eyebrow')}</div>
          <h2>{t('home.introTitle')}<br /><span>{t('home.introTitle2')}</span></h2>
        </div>
        <p>{t('home.introDescription').split(t('home.archiveLink'))[0]}<a href={IRSA_DOCS} target="_blank" rel="noreferrer">{t('home.archiveLink')}</a>.</p>
      </div>

      <div className="stats-row">
        <div className="stat-card"><span className="stat-icon purple"><Waves size={17} /></span><div><strong>102</strong><span>{t('home.channels')}</span></div><small>{t('home.missionDesign')}</small></div>
        <div className="stat-card"><span className="stat-icon blue"><Globe2 size={17} /></span><div><strong>{t('home.allSkyCoverage')}</strong><span>{t('home.surveyCoverage')}</span></div><small>{t('home.missionDesign')}</small></div>
        <div className="stat-card"><span className="stat-icon mint"><Radio size={17} /></span><div><strong>DR1</strong><span>{t('home.publicReleases')}</span></div><small>{t('home.archive')}</small></div>
        <div className="stat-card stat-live"><span className="stat-icon amber"><Clock3 size={17} /></span><div><strong>{t('home.liveSearch')}</strong><span>{t('home.queryPosition')}</span></div><small>{t('home.onRequest')}</small></div>
      </div>
      <div className="section-heading"><div><div className="eyebrow">{t('home.toolkit')}</div><h2>{t('home.exploreSurvey')}</h2></div><button className="text-button" onClick={() => navigate('explorer')}>{t('home.browseTools')} <ArrowUpRight size={15} /></button></div>
      <div className="feature-grid">
        <FeatureCard number="01" title={t('home.explorerTitle')} description={t('home.explorerDescription')} icon={Compass} color="violet" onClick={() => navigate('explorer')} />
        <FeatureCard number="02" title={t('home.timeTitle')} description={t('home.timeDescription')} icon={ArrowLeftRight} color="blue" onClick={() => navigate('time-machine')} />
        <FeatureCard number="03" title={t('home.spectrumTitle')} description={t('home.spectrumDescription')} icon={Waves} color="cyan" onClick={() => navigate('spectrum')} />
        <FeatureCard number="04" title={t('home.detectorTitle')} description={t('home.detectorDescription')} icon={Focus} color="pink" onClick={() => navigate('detector')} />
      </div>
      <div className="section-heading image-section-heading"><div><div className="eyebrow">{t('home.imageLibrary')}</div><h2>{t('home.infraredViews')}</h2></div><a className="text-button" href="https://images.nasa.gov/" target="_blank" rel="noreferrer">{t('home.nasaImages')} <ArrowUpRight size={15} /></a></div>
      <div className="reference-grid">{groups.slice(0, 3).map((group) => <ReferenceCard key={group.label} group={group} />)}</div>
      <div className="notice-bar"><Info size={16} /><span><b>{t('home.imageMatters')}</b> {t('home.imageNotice')}</span><a href={IRSA_DOCS} target="_blank" rel="noreferrer">{t('home.dataNotes')} <ArrowUpRight size={13} /></a></div>
    </div>
  )
}

function FeatureCard({ number, title, description, icon: Icon, color, onClick }: {
  number: string; title: string; description: string; icon: typeof Orbit; color: string; onClick: () => void
}) {
  return <button className="feature-card" onClick={onClick}><div className={`feature-icon ${color}`}><Icon size={19} /></div><span className="feature-number">{number}</span><h3>{title}</h3><p>{description}</p><span className="feature-arrow"><ArrowUpRight size={16} /></span></button>
}

function ReferenceCard({ group, compact = false }: { group: ImageGroup; compact?: boolean }) {
  const { t } = useTranslation()
  const [failed, setFailed] = useState(false)
  return (
    <article className={`reference-card ${compact ? 'reference-compact' : ''}`}>
      <div className="reference-image">
        {group.image && !failed ? <img src={group.image.imageUrl} alt={group.image.title} loading="lazy" onError={() => setFailed(true)} /> : <div className="illustration-fallback"><div className="fallback-nebula" /><span>{t('home.illustrationCaption')}</span></div>}
        <span className="image-source-tag">{group.image && !failed ? t('home.nasaReference') : t('home.illustration')}</span>
      </div>
      <div className="reference-details"><div><h3>{group.image?.title ?? t('home.infraredViews')}</h3><span>{group.image?.date ? t('home.referenceDate', { date: group.image.date }) : t('home.notObservation')}</span></div>{group.image && <a className="small-external" href={group.image.nasaUrl} target="_blank" rel="noreferrer" aria-label={t('home.openImage', { title: group.image.title })}><ArrowUpRight size={15} /></a>}</div>
    </article>
  )
}

function archiveField(observation: Observation, ...names: string[]): string {
  const matchingNames = new Set(names.map((name) => name.toLowerCase()))
  const entry = Object.entries(observation.raw).find(([key, value]) => matchingNames.has(key.toLowerCase()) && value)
  return entry?.[1] ?? ''
}

function ObservationThumbnail({ observation, onOpen }: { observation: Observation; onOpen: () => void }) {
  const { t } = useTranslation()
  const [useFitsPreview, setUseFitsPreview] = useState(!observation.previewUrl)
  const [failed, setFailed] = useState(false)
  const hasPreview = Boolean(observation.previewUrl || observation.accessUrl)
  const imageUrl = useFitsPreview && observation.accessUrl
    ? productThumbnailProxyUrl(observation.accessUrl)
    : observation.previewUrl
  const handleImageError = () => {
    if (!useFitsPreview && observation.accessUrl) setUseFitsPreview(true)
    else setFailed(true)
  }

  return (
    <button type="button" className="archive-result-image" onClick={onOpen} disabled={!hasPreview}
      aria-label={t('explorer.openPreview', { id: archiveField(observation, 'obs_id') || observation.target || t('explorer.observation') })}>
      {imageUrl && !failed
        ? <img src={imageUrl} alt={t('explorer.thumbnailAlt', { id: archiveField(observation, 'obs_id') || observation.target || t('explorer.observation') })} loading="lazy" decoding="async" onError={handleImageError} />
        : <span className="archive-thumbnail-empty"><Image size={20} />{t('explorer.previewUnavailable')}</span>}
      {hasPreview && <span className="archive-image-open"><Expand size={14} /></span>}
    </button>
  )
}

function SkyExplorer({ onOpenProduct, onCompareAt }: {
  onOpenProduct: (observation: Observation, observations?: Observation[]) => void
  onCompareAt: (ra: string, dec: string) => void
}) {
  const { t, i18n } = useTranslation()
  const [ra, setRa] = useState('83.822')
  const [dec, setDec] = useState('-5.391')
  const [observationId, setObservationId] = useState('')
  const [searchMode, setSearchMode] = useState<'position' | 'id'>('position')
  const [collectionMode, setCollectionMode] = useState<CollectionMode>('both')
  const [observations, setObservations] = useState<Observation[]>([])
  const [visibleCount, setVisibleCount] = useState(24)
  const [searchedAt, setSearchedAt] = useState('')
  const [cached, setCached] = useState(false)
  const [stale, setStale] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [searched, setSearched] = useState(false)
  async function search(event: FormEvent) {
    event.preventDefault()
    setError(''); setLoading(true); setSearched(true); setObservations([]); setVisibleCount(24); setSearchedAt(''); setStale(false)
    try {
      const collections = resolveCollections(collectionMode)
      const result = searchMode === 'id'
        ? await searchSpherexById(observationId, { collections, maxRec: 1000, allowStale: true })
        : await searchSpherex(Number(ra), Number(dec), 0.1, { collections, maxRec: 1000, allowStale: true })
      setObservations(result.observations)
      setSearchedAt(result.searchedAt)
      setCached(result.cached)
      setStale(Boolean(result.stale))
    } catch (reason) {
      console.error('SPHEREx archive search failed:', reason)
      const message = reason instanceof Error ? reason.message : 'explorer.errorQuery'
      if (message.startsWith('explorer.errorHttp:')) {
        const [, status, ...detailParts] = message.split(':')
        const detail = detailParts.join(':').trim()
        setError(`${t('explorer.errorHttp', { status })}${detail ? ` ${detail}` : ''}`)
      } else {
        setError(message.startsWith('explorer.') ? t(message) : t('explorer.errorQuery'))
      }
    } finally { setLoading(false) }
  }
  const openSearchedProduct = (observation: Observation) => onOpenProduct(observation, observations)
  const archiveUrl = searchMode === 'id'
    ? archiveIdSearchUrl(observationId, resolveCollections(collectionMode))
    : archiveSearchUrl(Number(ra) || 0, Number(dec) || 0, resolveCollections(collectionMode))
  const visibleObservations = observations.slice(0, visibleCount)

  return (
    <div>
      <PageIntro eyebrow={t('explorer.eyebrow')} title={t('explorer.title')} description={t('explorer.description')} icon={Compass} />
      <div className="explorer-layout">
        <section className="panel search-panel">
          <div className="panel-title-row"><div><div className="eyebrow">{t('explorer.searchArchive')}</div><h2>{t('explorer.choosePosition')}</h2></div><span className="archive-badge"><span className="live-dot" /> {t('explorer.release')}</span></div>
          <form onSubmit={search}>
            <div className="mode-tabs explorer-search-modes" role="group" aria-label={t('explorer.searchType')}>
              <button type="button" className={searchMode === 'position' ? 'mode-selected' : ''} aria-pressed={searchMode === 'position'} onClick={() => setSearchMode('position')}>{t('explorer.searchByPosition')}</button>
              <button type="button" className={searchMode === 'id' ? 'mode-selected' : ''} aria-pressed={searchMode === 'id'} onClick={() => setSearchMode('id')}>{t('explorer.searchById')}</button>
            </div>
            {searchMode === 'position'
              ? <div className="field-grid">
                <label>{t('explorer.ra')} <span>{t('explorer.degrees')}</span><input type="number" step="any" min="0" max="360" value={ra} onChange={(event) => setRa(event.target.value)} required /><small>{t('explorer.raRange')}</small></label>
                <label>{t('explorer.dec')} <span>{t('explorer.degrees')}</span><input type="number" step="any" min="-90" max="90" value={dec} onChange={(event) => setDec(event.target.value)} required /><small>{t('explorer.decRange')}</small></label>
              </div>
              : <label className="field-inline explorer-id-field">{t('explorer.observationId')}<input type="search" value={observationId} onChange={(event) => setObservationId(event.target.value)} placeholder={t('explorer.observationIdPlaceholder')} maxLength={512} required /></label>}
            <label className="field-inline">
              {t('explorer.collection')}
              <select value={collectionMode} onChange={(event) => setCollectionMode(event.target.value as CollectionMode)}>
                <option value="wide">{t('explorer.wideSurvey')}</option>
                <option value="deep">{t('explorer.deepSurvey')}</option>
                <option value="both">{t('explorer.bothSurveys')}</option>
              </select>
            </label>
            {searchMode === 'position' && <div className="coordinate-note"><Info size={14} /> {t('explorer.example')}</div>}
            <button className="button-primary search-submit" disabled={loading}>{loading ? <span className="spinner" /> : <Search size={16} />}{loading ? t('explorer.searching') : searchMode === 'id' ? t('explorer.searchIdSubmit') : t('explorer.search')}<ArrowUpRight size={15} /></button>
          </form>
          <div className="search-foot"><span><Info size={14} /> {t('explorer.metadataOnly')}</span><a href={IRSA_EXPLORER} target="_blank" rel="noreferrer">{t('explorer.viewIrsa')} <ExternalLink size={12} /></a></div>
        </section>
        <section className="panel coords-panel">
          <div className="panel-title-row"><div><div className="eyebrow">{t('explorer.sky')}</div><h2>{t('explorer.positionPreview')}</h2></div><span className="coordinate-chip">ICRS</span></div>
          <div className="sky-map" aria-label={t('explorer.coordinateGuide')}>
            <div className="sky-grid" /><div className="sky-crosshair"><span /><i /></div><div className="sky-coordinate">RA&nbsp; {Number(ra).toFixed(3)}°<br />DEC {Number(dec).toFixed(3)}°</div><span className="map-label">{t('explorer.coordinateGuide')}</span>
          </div>
        </section>
      </div>
      <section className="panel results-panel">
        <div className="panel-title-row archive-gallery-heading">
          <div><div className="eyebrow">{t('explorer.results')}</div><h2>{t('explorer.archiveResults')} <span className="muted-count">{observations.length}</span></h2></div>
          {searchedAt && <span className="updated-note"><Clock3 size={13} />{stale ? t('explorer.staleCache') : cached ? t('explorer.cached') : t('explorer.retrieved')} {new Date(searchedAt).toLocaleTimeString(i18n.resolvedLanguage)}</span>}
        </div>
        {loading && <div className="loading-state"><span className="spinner" />{t('explorer.loading')}</div>}
        {!loading && error && <div className="error-state"><ShieldAlert size={18} /><div><b>{t('explorer.errorTitle')}</b><span>{error}</span><a href={archiveUrl} target="_blank" rel="noreferrer">{t('explorer.openSia')} <ArrowUpRight size={13} /></a></div></div>}
        {!loading && !error && searched && observations.length === 0 && <div className="empty-state"><Image size={20} /><b>{t('explorer.noResults')}</b><span>{t('explorer.noResultsHelp')}</span><a href={searchMode === 'id' ? IRSA_EXPLORER : archiveUrl} target="_blank" rel="noreferrer">{t('explorer.exploreData')} <ArrowUpRight size={13} /></a></div>}
        {!loading && !error && !searched && <div className="empty-state"><Search size={20} /><b>{t('explorer.ready')}</b><span>{t('explorer.readyHelp')}</span></div>}
        {observations.length > 0 && <>
          {stale && <div className="archive-stale-note"><Info size={14} />{t('explorer.staleCacheHelp')}</div>}
          <div className="archive-result-count">{t('explorer.showingRecords', { count: visibleObservations.length, total: observations.length })}</div>
          <div className="archive-result-grid">{visibleObservations.map((observation, index) => {
            const observationId = archiveField(observation, 'obs_id', 'obs_publisher_did')
            const title = observationId || observation.target || t('explorer.observation')
            const facility = archiveField(observation, 'facility_name', 'facility')
            const instrument = archiveField(observation, 'instrument_name', 'instrument')
            const hasCoordinates = observation.ra !== '' && observation.dec !== ''
            return <article className="archive-result-card" key={`${observation.accessUrl || observation.previewUrl || observationId}-${index}`}>
              <ObservationThumbnail observation={observation} onOpen={() => openSearchedProduct(observation)} />
              <div className="archive-result-info">
                <div className="archive-result-tags">
                  <span>{observation.collection || observation.raw.obs_collection || t('explorer.release')}</span>
                  <span>{observation.accessUrl ? t('explorer.fitsAvailable') : observation.previewUrl ? t('explorer.previewOnly') : t('explorer.recordOnly')}</span>
                </div>
                <h3 title={title}>{title}</h3>
                <p className="archive-result-target">{observation.target || observation.raw.target_name || t('explorer.observation')}</p>
                <dl>
                  <div><dt>{t('explorer.observationTime')}</dt><dd>{formatObservationTimestamp(observation.date) || t('fits.notAvailable')}</dd></div>
                  {(facility || instrument) && <div><dt>{t('explorer.instrument')}</dt><dd>{[facility, instrument].filter(Boolean).join(' · ')}</dd></div>}
                  <div><dt>{t('explorer.wavelength')}</dt><dd>{observation.wavelengthMin !== null && observation.wavelengthMax !== null
                    ? `${(observation.wavelengthMin * 1e6).toFixed(2)}–${(observation.wavelengthMax * 1e6).toFixed(2)} μm`
                    : t('explorer.productMetadata')}</dd></div>
                  {hasCoordinates && <div><dt>{t('fits.coordinates')}</dt><dd>{Number(observation.ra).toFixed(5)}°, {Number(observation.dec).toFixed(5)}°</dd></div>}
                </dl>
                <div className="archive-result-actions">
                  {(observation.accessUrl || observation.previewUrl) && <button type="button" className="button-secondary" onClick={() => openSearchedProduct(observation)}>{t('explorer.openProduct')} <Expand size={13} /></button>}
                  {observation.accessUrl && <a className="button-secondary" href={productDownloadProxyUrl(observation.accessUrl)}><Download size={13} />{t('fits.download')}</a>}
                  {hasCoordinates && observation.accessUrl && <button type="button" className="text-button" onClick={() => onCompareAt(observation.ra, observation.dec)}>{t('explorer.compareBeforeAfter')} <ArrowUpRight size={13} /></button>}
                </div>
              </div>
            </article>
          })}</div>
          {visibleCount < observations.length && <div className="archive-load-more"><button type="button" className="button-secondary" onClick={() => setVisibleCount((count) => Math.min(count + 24, observations.length))}>{t('explorer.loadMore')}</button></div>}
          <div className="result-notice"><Info size={14} /> {t('explorer.resultNotice')}</div>
        </>}
      </section>
      <div className="citation-strip"><BadgeCheck size={16} /><span>{t('explorer.citation')} <a href="https://doi.org/10.26131/IRSA678" target="_blank" rel="noreferrer">10.26131/IRSA678</a></span><a href={IRSA_DOCS} target="_blank" rel="noreferrer">{t('explorer.documentation')} <ArrowUpRight size={13} /></a></div>
    </div>
  )
}

function productBandKey(observation: Observation): string {
  try {
    const segments = new URL(observation.accessUrl).pathname.split('/').filter(Boolean)
    return segments.length > 1 ? segments[segments.length - 2] : ''
  } catch {
    return ''
  }
}

function TimeMachine({ initialPosition, navigate, onComparisonChange, onOpenProduct }: {
  initialPosition: { ra: string; dec: string } | null
  onComparisonChange: (evidence: ComparisonEvidence | null) => void
  navigate: (page: Page) => void; onOpenProduct: (observation: Observation) => void
}) {
  const { t } = useTranslation()
  const comparisonViewerRef = useRef<HTMLDivElement>(null)
  const comparisonStageRef = useRef<HTMLDivElement>(null)
  const comparisonDragRef = useRef<{ x: number; y: number } | null>(null)
  const [position, setPosition] = useState(50)
  const [comparisonZoom, setComparisonZoom] = useState(1)
  const [comparisonPan, setComparisonPan] = useState({ x: 0, y: 0 })
  const [mode, setMode] = useState<'slider' | 'side' | 'overlay' | 'difference'>('slider')
  const [ra, setRa] = useState(initialPosition?.ra ?? '83.822')
  const [dec, setDec] = useState(initialPosition?.dec ?? '-5.391')
  const [observations, setObservations] = useState<Observation[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [band, setBand] = useState('')
  const [earlierIndex, setEarlierIndex] = useState(0)
  const [laterIndex, setLaterIndex] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [comparing, setComparing] = useState(false)
  const [comparisonError, setComparisonError] = useState('')
  const [comparison, setComparison] = useState<FitsComparison | null>(null)
  const [selectedSourceId, setSelectedSourceId] = useState('')

  const bandChoices = useMemo(() => {
    const timesByBand = new Map<string, Set<number>>()
    for (const observation of observations) {
      const key = productBandKey(observation)
      if (!key) continue
      const times = timesByBand.get(key) ?? new Set<number>()
      times.add(observationTimeValue(observation.date))
      timesByBand.set(key, times)
    }
    return [...timesByBand].filter(([, times]) => times.size > 1).map(([key]) => key)
  }, [observations])
  const selectedBand = bandChoices.includes(band) ? band : bandChoices[0] ?? ''
  const pairOptions = useMemo(() => {
    const byTime = new Map<number, Observation>()
    for (const observation of observations) {
      if (productBandKey(observation) !== selectedBand) continue
      const time = observationTimeValue(observation.date)
      if (!byTime.has(time)) byTime.set(time, observation)
    }
    return [...byTime.values()].sort((a, b) => observationTimeValue(a.date) - observationTimeValue(b.date))
  }, [observations, selectedBand])
  const earlier = pairOptions[earlierIndex] ?? pairOptions[0]
  const later = pairOptions[laterIndex] ?? pairOptions[pairOptions.length - 1]
  const selectedSource = comparison?.sources.find((source) => source.id === selectedSourceId)

  async function searchTimeline(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError('')
    setComparison(null); setComparisonError(''); onComparisonChange(null)
    try {
      const result = await searchSpherex(Number(ra), Number(dec))
      const chronological = result.observations.filter((observation) => observation.accessUrl)
        .sort((a, b) => observationTimeValue(a.date) - observationTimeValue(b.date))
      const byBand = new Map<string, Set<number>>()
      for (const observation of chronological) {
        const key = productBandKey(observation)
        if (key) {
          const times = byBand.get(key) ?? new Set<number>()
          times.add(observationTimeValue(observation.date))
          byBand.set(key, times)
        }
      }
      const firstComparableBand = [...byBand].find(([, times]) => times.size > 1)?.[0] ?? ''
      setObservations(chronological); setSelectedIndex(0); setBand(firstComparableBand)
      setEarlierIndex(0); setLaterIndex(1)
    } catch (reason) {
      console.error('SPHEREx archive timeline query failed:', reason)
      setError(t('newUI.timelineError'))
      setObservations([])
    } finally { setLoading(false) }
  }

  async function compareObservations() {
    if (!earlier || !later) return
    setComparing(true); setComparisonError(''); setComparison(null); setSelectedSourceId(''); onComparisonChange(null)
    try {
      const response = await fetch(apiUrl(productComparisonProxyUrl({ observation: earlier }, { observation: later })), {
        signal: AbortSignal.timeout(180000),
      })
      if (!response.ok) {
        const detail = await response.text()
        throw new Error(`Comparison request failed (${response.status}): ${detail}`)
      }
      const result = await response.json() as FitsComparison
      setComparison(result)
      onComparisonChange({ result, ra: Number(ra), dec: Number(dec), earlierDate: formatObservationTimestamp(earlier.date), laterDate: formatObservationTimestamp(later.date) })
    } catch (reason) {
      console.error('SPHEREx observation comparison failed:', reason)
      setComparisonError(t('newUI.comparisonUnavailable'))
    } finally { setComparing(false) }
  }

  const selectMode = (nextMode: typeof mode) => setMode(nextMode)
  const resetComparisonView = () => { setComparisonZoom(1); setComparisonPan({ x: 0, y: 0 }) }
  const updateComparisonPosition = (clientX: number) => {
    const stage = comparisonStageRef.current
    if (!stage) return
    const bounds = stage.getBoundingClientRect()
    if (bounds.width === 0) return
    setPosition(Math.max(0, Math.min(100, ((clientX - bounds.left) / bounds.width) * 100)))
  }
  const startComparisonSliderDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    updateComparisonPosition(event.clientX)
  }
  const moveComparisonSlider = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    event.preventDefault()
    event.stopPropagation()
    updateComparisonPosition(event.clientX)
  }
  const startComparisonPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (comparisonZoom <= 1 || (event.target instanceof HTMLElement && event.target.closest('button'))) return
    event.currentTarget.setPointerCapture(event.pointerId)
    comparisonDragRef.current = { x: event.clientX - comparisonPan.x, y: event.clientY - comparisonPan.y }
  }
  const moveComparisonPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (comparisonDragRef.current) setComparisonPan({ x: event.clientX - comparisonDragRef.current.x, y: event.clientY - comparisonDragRef.current.y })
  }

  useEffect(() => {
    const viewport = comparisonViewerRef.current
    if (!comparison || !viewport) return
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault()
      setComparisonZoom((value) => Math.max(1, Math.min(8, value * (event.deltaY < 0 ? 1.12 : 1 / 1.12))))
    }
    viewport.addEventListener('wheel', handleWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', handleWheel)
  }, [Boolean(comparison)])

  return (
    <div>
      <PageIntro eyebrow={t('time.eyebrow')} title={t('time.title')} description={t('time.description')} icon={Clock3} />
      <section className="panel timeline-panel">
        <div className="panel-title-row"><div><div className="eyebrow">{t('newUI.timelineEyebrow')}</div><h2>{t('newUI.timelineTitle')}</h2></div><span className="archive-badge"><span className="live-dot" /> IRSA · DR1</span></div>
        <p>{t('newUI.timelineHelp')}</p>
        <form className="timeline-search" onSubmit={searchTimeline}>
          <label>RA (°)<input type="number" step="any" min="0" max="360" value={ra} onChange={(event) => setRa(event.target.value)} required /></label>
          <label>Dec (°)<input type="number" step="any" min="-90" max="90" value={dec} onChange={(event) => setDec(event.target.value)} required /></label>
          <button className="button-primary" disabled={loading}>{loading ? <span className="spinner" /> : <Search size={14} />}{loading ? t('newUI.timelineLoading') : t('newUI.timelineSearch')}</button>
        </form>
        {error && <div className="empty-inline">{error}</div>}
        {!loading && observations.length > 0 && <>
          <div className="timeline-selected" aria-live="polite"><div><span>{t('newUI.timelineRecord', { count: observations.length })}</span><strong>{formatObservationTimestamp(observations[selectedIndex]?.date ?? '') || t('fits.notAvailable')}</strong></div>
            <button type="button" className="text-button" onClick={() => onOpenProduct(observations[selectedIndex])}>{t('explorer.openProduct')} <ArrowUpRight size={13} /></button></div>
          {observations[selectedIndex] && <FitsProductViewer observation={observations[selectedIndex]} compact preservePrevious />}
          {observations.length > 1 && <div className="timeline-range-wrap">
            <input className="comparison-range timeline-range" aria-label={t('newUI.timelineTitle')} aria-valuetext={formatObservationTimestamp(observations[selectedIndex].date)} type="range" min="0" max={observations.length - 1} value={selectedIndex} onChange={(event) => setSelectedIndex(Number(event.target.value))} />
            <div className="timeline-range-labels"><span>{formatObservationTimestamp(observations[0].date)}</span><span>{formatObservationTimestamp(observations[observations.length - 1].date)}</span></div>
          </div>}
          <div className="timeline-records">{observations.map((observation, index) => <button type="button" key={`${observation.accessUrl}-${index}`} className={index === selectedIndex ? 'timeline-record active' : 'timeline-record'} aria-pressed={index === selectedIndex} onClick={() => setSelectedIndex(index)}><span>{formatObservationTimestamp(observation.date) || t('fits.notAvailable')}</span><small>{observation.raw.obs_id || observation.target || t('explorer.observation')}</small></button>)}</div>
        </>}
        {!loading && observations.length === 0 && <div className="empty-inline">{t('newUI.timelineEmpty')}</div>}
      </section>

      <section className="panel source-comparison-panel">
        <div className="panel-title-row"><div><div className="eyebrow">{t('newUI.comparisonEyebrow')}</div><h2>{t('newUI.comparisonTitle')}</h2></div><div className="report-actions">{comparison && <button type="button" className="button-secondary" onClick={() => navigate('reports')}><FileText size={14} />{t('newUI.openEvidence')}</button>}<button type="button" className="button-secondary" onClick={() => window.print()} disabled={!comparison}><FileText size={14} />{t('newUI.exportPdf')}</button></div></div>
        <p>{t('newUI.comparisonHelp')}</p>
        {bandChoices.length > 0 && <div className="comparison-selectors">
          <label>{t('newUI.bandLabel')}<select value={selectedBand} onChange={(event) => { setBand(event.target.value); setEarlierIndex(0); setLaterIndex(1); setComparison(null); onComparisonChange(null) }}>{bandChoices.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          <label>{t('newUI.earlierObservation')}<select value={earlierIndex} onChange={(event) => { setEarlierIndex(Number(event.target.value)); setComparison(null); onComparisonChange(null) }}>{pairOptions.map((observation, index) => <option key={`${observation.accessUrl}-${index}`} value={index}>{formatObservationTimestamp(observation.date)}</option>)}</select></label>
          <label>{t('newUI.laterObservation')}<select value={laterIndex} onChange={(event) => { setLaterIndex(Number(event.target.value)); setComparison(null); onComparisonChange(null) }}>{pairOptions.map((observation, index) => <option key={`${observation.accessUrl}-${index}`} value={index}>{formatObservationTimestamp(observation.date)}</option>)}</select></label>
          <button type="button" className="button-primary" onClick={() => void compareObservations()} disabled={comparing || !earlier || !later || earlierIndex === laterIndex}>{comparing ? <span className="spinner" /> : <Activity size={14} />}{comparing ? t('newUI.analyzing') : t('newUI.compareNow')}</button>
        </div>}
        {!loading && observations.length > 0 && bandChoices.length === 0 && <div className="empty-inline">{t('newUI.noMatchingBand')}</div>}
        {comparisonError && <div className="clean-data-note">{comparisonError}</div>}
        {comparing && <div className="loading-state"><span className="spinner" />{t('newUI.analyzing')}</div>}
        {comparison && <div className="comparison-result">
          <div className="comparison-date-row"><span>{t('newUI.earlierObservation')}: <b>{formatObservationTimestamp(earlier?.date ?? '')}</b></span><span>{t('newUI.laterObservation')}: <b>{formatObservationTimestamp(later?.date ?? '')}</b></span><span>{t('newUI.bandLabel')}: <b>{comparison.earlier.band}</b></span><span>{t('fits.coordinates')}: <b>{comparison.earlier.center_ra.toFixed(5)}°, {comparison.earlier.center_dec.toFixed(5)}°</b></span></div>
          <div className="mode-tabs comparison-mode-tabs" role="group" aria-label={t('newUI.comparisonTitle')}>
            <button type="button" className={mode === 'side' ? 'mode-selected' : ''} onClick={() => selectMode('side')}><ArrowLeftRight size={14} />{t('time.sideBySide')}</button>
            <button type="button" className={mode === 'slider' ? 'mode-selected' : ''} onClick={() => selectMode('slider')}><MoveHorizontal size={14} />{t('time.slider')}</button>
            <button type="button" className={mode === 'overlay' ? 'mode-selected' : ''} onClick={() => selectMode('overlay')}><Layers size={14} />{t('time.overlay')}</button>
            <button type="button" className={mode === 'difference' ? 'mode-selected' : ''} onClick={() => selectMode('difference')}><Activity size={14} />{t('time.difference')}</button>
          </div>
          <div className="comparison-view-controls">
            <button type="button" className="icon-button" aria-label={t('fits.zoomIn')} onClick={() => setComparisonZoom((value) => Math.min(8, value * 1.25))}>+</button>
            <button type="button" className="icon-button" aria-label={t('fits.zoomOut')} onClick={() => setComparisonZoom((value) => Math.max(1, value / 1.25))}>−</button>
            <button type="button" className="icon-button" aria-label={t('fits.reset')} onClick={resetComparisonView}><RotateCcw size={14} /></button>
            <button type="button" className="icon-button" aria-label={t('fits.fullscreen')} onClick={() => void comparisonViewerRef.current?.requestFullscreen()}><Expand size={14} /></button>
            <span>{t('fits.zoom')}: {Math.round(comparisonZoom * 100)}%</span>
          </div>
          <div className="science-viewport" ref={comparisonViewerRef} onPointerDown={startComparisonPan} onPointerMove={moveComparisonPan} onPointerUp={() => { comparisonDragRef.current = null }} onPointerCancel={() => { comparisonDragRef.current = null }}>
          <div className={`science-images mode-${mode}`} style={{ transform: `translate(${comparisonPan.x}px, ${comparisonPan.y}px) scale(${comparisonZoom})` }}>
            {mode === 'side' && <>
              <SourceImage comparison={comparison} image={comparison.images.earlier_png} date={formatObservationTimestamp(earlier?.date ?? '')} side="earlier" selectedSourceId={selectedSourceId} onSelect={setSelectedSourceId} />
              <SourceImage comparison={comparison} image={comparison.images.later_png} date={formatObservationTimestamp(later?.date ?? '')} side="later" selectedSourceId={selectedSourceId} onSelect={setSelectedSourceId} />
            </>}
            {(mode === 'slider' || mode === 'overlay') && <div className="science-slider-stage" ref={comparisonStageRef} style={{ aspectRatio: `${comparison.comparison.width} / ${comparison.comparison.height}` }}>
              <SourceImage comparison={comparison} image={comparison.images.later_png} date={formatObservationTimestamp(later?.date ?? '')} side="later" selectedSourceId={selectedSourceId} onSelect={setSelectedSourceId} />
              <div className="science-old-clip" style={mode === 'slider' ? { clipPath: `inset(0 ${100 - position}% 0 0)` } : undefined}>
                <SourceImage comparison={comparison} image={comparison.images.earlier_png} date={formatObservationTimestamp(earlier?.date ?? '')} side="earlier" selectedSourceId={selectedSourceId} onSelect={setSelectedSourceId} />
              </div>
              {mode === 'slider' && <>
                <div className="science-image-side-labels" aria-hidden="true">
                  <span>{t('time.beforeLabel')}</span>
                  <span>{t('time.afterLabel')}</span>
                </div>
                <button
                  type="button"
                  role="slider"
                  className="science-slider-handle"
                  style={{ left: `${position}%` }}
                  aria-label={t('time.moveDivider')}
                  aria-orientation="horizontal"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(position)}
                  onPointerDown={startComparisonSliderDrag}
                  onPointerMove={moveComparisonSlider}
                  onPointerUp={(event) => {
                    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
                  }}
                  onPointerCancel={(event) => {
                    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
                  }}
                  onKeyDown={(event) => {
                    const step = event.shiftKey ? 10 : 1
                    const next = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? position - step
                      : event.key === 'ArrowRight' || event.key === 'ArrowUp' ? position + step
                        : event.key === 'Home' ? 0
                          : event.key === 'End' ? 100
                            : null
                    if (next !== null) {
                      event.preventDefault()
                      setPosition(Math.max(0, Math.min(100, next)))
                    }
                  }}
                />
              </>}
            </div>}
            {mode === 'difference' && <SourceImage comparison={comparison} image={comparison.images.difference_png} date={t('newUI.alignedDifference')} side="difference" selectedSourceId={selectedSourceId} onSelect={setSelectedSourceId} />}
          </div>
          </div>
          <div className="source-legend">
            <span><i className="legend-common" />{t('newUI.status.common')}</span><span><i className="legend-new" />{t('newUI.status.new_candidate')}</span><span><i className="legend-brightness" />{t('newUI.status.brightness_candidate')}</span><span><i className="legend-uncertain" />{t('newUI.status.not_detected_later')}</span>
          </div>
          <div className="comparison-summary">
            <h3>{t('newUI.summaryTitle')}</h3>
            <div className="summary-counts">
              <span>{t('newUI.countEarlier')}<b>{comparison.summary.earlier_detected}</b></span><span>{t('newUI.countLater')}<b>{comparison.summary.later_detected}</b></span><span>{t('newUI.countCommon')}<b>{comparison.summary.common}</b></span><span>{t('newUI.countNew')}<b>{comparison.summary.new_candidates}</b></span><span>{t('newUI.countMissing')}<b>{comparison.summary.not_detected_later}</b></span><span>{t('newUI.countBrightness')}<b>{comparison.summary.brightness_candidates}</b></span><span>{t('newUI.countPosition')}<b>{comparison.summary.position_candidates}</b></span>
            </div>
            <p>{t('newUI.qualityNote')}</p>
          </div>
          <div className="panel-title-row source-table-heading"><div><div className="eyebrow">{t('newUI.sourceTableEyebrow')}</div><h3>{t('newUI.sourceTableTitle', { count: comparison.sources.length })}</h3></div></div>
          {comparison.source_list_truncated && <div className="clean-data-note">{t('newUI.sourceListNote', { count: comparison.displayed_source_limit })}</div>}
          <div className="table-scroll"><table className="source-table"><thead><tr><th>{t('newUI.objectId')}</th><th>{t('newUI.objectType')}</th><th>{t('newUI.earlierDetection')}</th><th>{t('newUI.laterDetection')}</th><th>{t('newUI.brightnessChange')}</th><th>{t('newUI.positionChange')}</th><th>{t('newUI.classification')}</th></tr></thead><tbody>
            {comparison.sources.map((source) => <tr key={source.id} className={source.id === selectedSourceId ? 'source-row-selected' : ''} onClick={() => setSelectedSourceId(source.id)} tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setSelectedSourceId(source.id) }}>
              <td>{source.id}</td><td>{t('newUI.unclassifiedSource')}</td><td>{source.earlier ? `${source.earlier.ra.toFixed(5)}°, ${source.earlier.dec.toFixed(5)}°` : '—'}</td><td>{source.later ? `${source.later.ra.toFixed(5)}°, ${source.later.dec.toFixed(5)}°` : '—'}</td><td>{source.brightness_percent === undefined ? '—' : `${source.brightness_percent.toFixed(1)}%`}</td><td>{source.position_delta_arcsec === undefined ? '—' : `${source.position_delta_arcsec.toFixed(2)}″`}</td><td>{t(`newUI.status.${source.status}`)}</td>
            </tr>)}
          </tbody></table></div>
          {selectedSource && <section className="source-detail">
            <div><div className="eyebrow">{t('newUI.objectDetails')}</div><h3>{selectedSource.id} · {t(`newUI.status.${selectedSource.status}`)}</h3></div>
            <div className="source-detail-grid"><span>{t('newUI.earlierCoordinates')}<b>{selectedSource.earlier ? `${selectedSource.earlier.ra.toFixed(6)}°, ${selectedSource.earlier.dec.toFixed(6)}°` : '—'}</b></span>
              <span>{t('newUI.laterCoordinates')}<b>{selectedSource.later ? `${selectedSource.later.ra.toFixed(6)}°, ${selectedSource.later.dec.toFixed(6)}°` : '—'}</b></span>
              <span>{t('newUI.earlierBrightness')}<b>{selectedSource.earlier ? `${selectedSource.earlier.flux.toPrecision(5)} ± ${selectedSource.earlier.flux_error.toPrecision(3)} ${comparison.earlier.unit}` : '—'}</b></span>
              <span>{t('newUI.laterBrightness')}<b>{selectedSource.later ? `${selectedSource.later.flux.toPrecision(5)} ± ${selectedSource.later.flux_error.toPrecision(3)} ${comparison.later.unit}` : '—'}</b></span>
              <span>{t('newUI.brightnessDelta')}<b>{selectedSource.brightness_delta === undefined ? '—' : `${selectedSource.brightness_delta.toPrecision(5)} ${comparison.earlier.unit} · ${(selectedSource.brightness_percent ?? 0).toFixed(1)}%`}</b></span>
              <span>{t('newUI.positionShift')}<b>{selectedSource.position_delta_arcsec === undefined ? '—' : `${selectedSource.position_delta_arcsec.toFixed(2)}″`}</b></span>
              <span>{t('newUI.detectionSnr')}<b>{[selectedSource.earlier?.snr, selectedSource.later?.snr].filter((value): value is number => value !== undefined).map((value) => value.toFixed(1)).join(' / ') || '—'}</b></span>
            </div>
            <p>{t(`newUI.explanation.${selectedSource.status}`)}</p>
          </section>}
          <div className="compare-caption"><span>{t('newUI.overlapArea', { pixels: comparison.comparison.overlap_pixels })}</span><span>{comparison.comparison.width} × {comparison.comparison.height} px · {comparison.earlier.pixel_scale_arcsec.toFixed(3)}″/px</span></div>
        </div>}
        {!comparison && !comparing && observations.length > 0 && <div className="empty-inline">{t('newUI.comparisonPrompt')}</div>}
        {!observations.length && <div className="empty-inline">{t('newUI.comparisonSearchPrompt')} <button type="button" className="text-button" onClick={() => navigate('explorer')}>{t('time.searchArchive')} <ArrowUpRight size={12} /></button></div>}
      </section>
    </div>
  )
}

function SourceImage({ comparison, image, date, side, selectedSourceId, onSelect }: {
  comparison: FitsComparison
  image: string
  date: string
  side: 'earlier' | 'later' | 'difference'
  selectedSourceId: string
  onSelect: (id: string) => void
}) {
  const { t } = useTranslation()
  const sideLabel = side === 'earlier' ? t('time.beforeLabel') : side === 'later' ? t('time.afterLabel') : t('newUI.alignedDifference')
  const availableSources = comparison.sources.filter((source) => (
    side === 'earlier' ? source.earlier !== null
      : side === 'later' ? source.later !== null
        : source.earlier !== null || source.later !== null
  ))
  return <figure className="science-image" style={{ aspectRatio: `${comparison.comparison.width} / ${comparison.comparison.height}` }}>
    <img src={`data:image/png;base64,${image}`} alt={`${sideLabel} · ${date}`} />
    <div className="source-markers">{availableSources.map((source) => {
      const point = side === 'earlier' ? source.earlier : source.later ?? source.earlier
      if (!point) return null
      const color = source.status === 'new_candidate' ? 'new' : source.status === 'brightness_candidate' ? 'brightness' : source.status === 'position_candidate' ? 'position' : source.status === 'common' ? 'common' : 'uncertain'
      return <button key={source.id} type="button" title={`${source.id}: ${point.ra.toFixed(5)}, ${point.dec.toFixed(5)}`} aria-label={t('newUI.selectSource', { id: source.id })} className={`source-marker marker-${color} ${selectedSourceId === source.id ? 'marker-selected' : ''}`} style={{ left: `${point.x / comparison.comparison.width * 100}%`, top: `${point.y / comparison.comparison.height * 100}%` }} onClick={() => onSelect(source.id)} />
    })}</div>
    <figcaption><span>{sideLabel}</span><b>{date}</b></figcaption>
  </figure>
}

function SpectrumViewer() {
  const { t } = useTranslation()
  const [wavelength, setWavelength] = useState(2.4)
  const band = useMemo(() => nominalBands.find((item) => {
    const bounds = item.label.replace(' μm', '').split('–').map(Number)
    return wavelength >= bounds[0] && wavelength <= bounds[1]
  }) ?? nominalBands[0], [wavelength])
  return (
    <div>
      <PageIntro eyebrow={t('spectrum.eyebrow')} title={t('nav.spectrum')} description={t('spectrum.description')} icon={Waves} />
      <div className="spectrum-layout">
        <section className="panel spectrum-panel">
          <div className="panel-title-row"><div><div className="eyebrow">{t('spectrum.coverage')}</div><h2>{t('spectrum.nearInfrared')}</h2></div><span className="coverage-chip">0.75 — 5.0 μm</span></div>
          <div className="spectrum-chart-wrap spectrum-coverage-chart">
            <div className="coverage-title"><strong>{t('newUI.coverageTitle')}</strong><span>{t('spectrum.noSpectrum')}</span></div>
            <div className="coverage-track">{nominalBands.map((item, index) => {
              const bounds = item.label.replace(' μm', '').split('–').map(Number)
              const width = ((bounds[1] - bounds[0]) / (5 - 0.75)) * 100
              const left = ((bounds[0] - 0.75) / (5 - 0.75)) * 100
              return <button key={item.label} className={`coverage-segment ${item === band ? 'coverage-active' : ''}`} style={{ left: `${left}%`, width: `${width}%`, backgroundColor: item.color }} aria-label={t('newUI.bandSelect', { band: item.label })} onClick={() => setWavelength((bounds[0] + bounds[1]) / 2)} title={`${index + 1}: ${item.label}`} />
            })}</div>
            <div className="coverage-axis">{[0.75, 1, 2, 3, 4, 5].map((value) => <span key={value}>{value}</span>)}</div>
            <div className="coverage-marker" style={{ left: `${((wavelength - 0.75) / (5 - 0.75)) * 100}%` }}><i /><span>{wavelength.toFixed(2)} μm</span></div>
            <div className="coverage-caption">{t('newUI.coverageOnly')}</div>
          </div>
          <div className="spectrum-slider-row"><label htmlFor="wave-slider">{t('spectrum.exploreWavelength')} <b>{wavelength.toFixed(2)} μm</b></label><input id="wave-slider" type="range" min="0.75" max="5" step="0.01" value={wavelength} onChange={(event) => setWavelength(Number(event.target.value))} /><div className="slider-ticks"><span>0.75 μm</span><span>2.88 μm</span><span>5.0 μm</span></div></div>
        </section>
        <section className="panel band-panel">
          <div className="eyebrow">{t('spectrum.missionDesign')}</div><h2>{t('spectrum.ranges')}</h2><p>{t('spectrum.rangeHelp')}</p>
          <div className="band-list">{nominalBands.map((item, index) => <button key={item.label} className={`band-row ${item === band ? 'band-active' : ''}`} onClick={() => { const bounds = item.label.replace(' μm', '').split('–').map(Number); setWavelength((bounds[0] + bounds[1]) / 2) }}><i style={{ backgroundColor: item.color }} /><span>{item.label}</span><small>{index < 4 ? 'R ≈ 35–41' : 'R ≈ 112–128'}</small>{item === band && <Check size={14} />}</button>)}</div>
          <div className="spectrum-reading"><span>{t('newUI.selectedWavelength')}</span><strong>{wavelength.toFixed(2)} μm</strong><small>{t('newUI.noIntensity')}</small></div>
          <div className="channel-note"><Info size={14} /><span>{t('spectrum.channelNote')}</span></div>
        </section>
      </div>
      <div className="citation-strip"><BadgeCheck size={16} /><span>{t('spectrum.citation')} <a href="https://irsa.ipac.caltech.edu/Missions/spherex.html" target="_blank" rel="noreferrer">{t('spectrum.characteristics')}</a>.</span><a href={IRSA_DOCS} target="_blank" rel="noreferrer">{t('spectrum.dataGuide')} <ArrowUpRight size={13} /></a></div>
    </div>
  )
}

function ChangeDetector({ onOpenProduct, onCompareAt }: {
  onOpenProduct: (observation: Observation) => void
  onCompareAt: (ra: string, dec: string) => void
}) {
  const { t } = useTranslation()
  const [ra, setRa] = useState('83.822')
  const [dec, setDec] = useState('-5.391')
  const [observations, setObservations] = useState<Observation[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  async function searchPosition(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError('')
    try {
      const result = await searchSpherex(Number(ra), Number(dec))
      setObservations(result.observations.filter((observation) => observation.accessUrl)
        .sort((a, b) => observationTimeValue(a.date) - observationTimeValue(b.date)))
    } catch (reason) {
      console.error('SPHEREx change-review query failed:', reason)
      setError(t('newUI.searchError')); setObservations([])
    } finally { setLoading(false) }
  }
  return (
    <div>
      <PageIntro eyebrow={t('detector.eyebrow')} title={t('nav.detector')} description={t('detector.description')} icon={Focus} />
      <div className="notice-bar"><Info size={17} /><span><b>{t('detector.noCandidates')}</b> {t('detector.noCandidatesHelp')}</span><a href={IRSA_DOCS} target="_blank" rel="noreferrer">{t('detector.methodNotes')} <ArrowUpRight size={13} /></a></div>
      <section className="panel detector-search">
        <div className="panel-title-row"><div><div className="eyebrow">{t('newUI.archiveProducts')}</div><h2>{t('newUI.selectRegion')}</h2></div></div>
        <form className="timeline-search" onSubmit={searchPosition}>
          <label>RA (°)<input type="number" step="any" min="0" max="360" value={ra} onChange={(event) => setRa(event.target.value)} required /></label>
          <label>Dec (°)<input type="number" step="any" min="-90" max="90" value={dec} onChange={(event) => setDec(event.target.value)} required /></label>
          <button className="button-primary" disabled={loading}>{loading ? <span className="spinner" /> : <Search size={14} />}{loading ? t('newUI.searching') : t('newUI.findProducts')}</button>
        </form>
        {error && <div className="empty-inline">{error}</div>}
        {!loading && observations.length > 0 && <div className="detector-product-list">
          <p>{t('newUI.imageRecords', { count: observations.length })}</p>
          {observations.slice(0, 8).map((observation, index) => <div className="detector-product-row" key={`${observation.accessUrl}-${index}`}>
            <span><b>{observation.raw.obs_id || observation.target || t('explorer.observation')}</b><small>{formatObservationDate(observation.date) || t('fits.notAvailable')}</small></span>
            <button type="button" className="text-button" onClick={() => onOpenProduct(observation)}>{t('newUI.viewImage')} <ArrowUpRight size={13} /></button>
          </div>)}
          {observations.length > 1 && <button type="button" className="button-primary detector-compare-button" onClick={() => onCompareAt(ra, dec)}>{t('detector.comparePair')} <ArrowLeftRight size={14} /></button>}
          <FitsProductViewer key={observations[0].accessUrl} observation={observations[0]} compact />
        </div>}
        {!loading && observations.length === 0 && <div className="empty-inline">{t('newUI.searchReady')}</div>}
      </section>
      <div className="detector-grid">
        <section className="panel detector-intro"><div className="detector-symbol"><Focus size={27} /></div><div className="eyebrow">{t('detector.reviewStatus')}</div><h2>{t('detector.awaiting')}</h2><p>{t('detector.awaitingHelp')}</p><span className="status-pill">{t('detector.notPerformed')}</span></section>
        <div className="detector-checks">
          <CheckRow number="01" title={t('detector.footprint')} detail={t('detector.footprintHelp')} />
          <CheckRow number="02" title={t('detector.calibration')} detail={t('detector.calibrationHelp')} />
          <CheckRow number="03" title={t('detector.registration')} detail={t('detector.registrationHelp')} />
          <CheckRow number="04" title={t('detector.artifacts')} detail={t('detector.artifactsHelp')} />
          <CheckRow number="05" title={t('detector.human')} detail={t('detector.humanHelp')} />
        </div>
      </div>
      <div className="section-heading compact-heading"><div><div className="eyebrow">{t('detector.labelsEyebrow')}</div><h2>{t('detector.outcomes')}</h2></div></div>
      <div className="outcome-grid">
        <OutcomeCard label={t('detector.possibleChange')} color="violet" text={t('detector.possibleChangeHelp')} />
        <OutcomeCard label={t('detector.candidate')} color="blue" text={t('detector.candidateHelp')} />
        <OutcomeCard label={t('detector.qualityIssue')} color="amber" text={t('detector.qualityIssueHelp')} />
        <OutcomeCard label={t('detector.noChange')} color="mint" text={t('detector.noChangeHelp')} />
      </div>
    </div>
  )
}

function CheckRow({ number, title, detail }: { number: string; title: string; detail: string }) {
  const { t } = useTranslation()
  return <div className="check-row"><span>{number}</span><div><strong>{title}</strong><small>{detail}</small></div><span className="check-wait">{t('detector.checks')}</span></div>
}
function OutcomeCard({ label, color, text }: { label: string; color: string; text: string }) {
  return <div className={`outcome-card outcome-${color}`}><span className="outcome-indicator" /><strong>{label}</strong><p>{text}</p></div>
}

function Reports({ evidence, navigate }: {
  evidence: ComparisonEvidence | null
  navigate: (page: Page) => void
}) {
  const { t } = useTranslation()
  const [ra, setRa] = useState('83.822')
  const [dec, setDec] = useState('-5.391')
  const [records, setRecords] = useState<Observation[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [noRecords, setNoRecords] = useState(false)
  const [reportImage, setReportImage] = useState<Observation | null>(null)
  async function loadReport(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError(''); setNoRecords(false); setLoaded(false); setRecords([]); setReportImage(null)
    try {
      const result = await searchSpherex(Number(ra), Number(dec))
      const products = result.observations.filter((row) => row.accessUrl)
      setRecords(products); setReportImage(products[0] ?? null); setLoaded(products.length > 0); setNoRecords(products.length === 0)
    }
    catch (reason) {
      console.error('SPHEREx evidence report search failed:', reason)
      const message = reason instanceof Error ? reason.message : 'explorer.errorQuery'
      setError(message.startsWith('explorer.errorHttp:')
        ? t('explorer.errorHttp', { status: message.split(':')[1] })
        : message.startsWith('explorer.') ? t(message) : t('explorer.errorQuery'))
    }
    finally { setLoading(false) }
  }
  return (
    <div>
      <PageIntro eyebrow={t('reports.eyebrow')} title={t('nav.reports')} description={t('reports.description')} icon={FileText} />
    {evidence && <EvidenceComparisonReport evidence={evidence} />}
    {!evidence && <section className="panel report-search"><div><div className="eyebrow">{t('newUI.comparisonEyebrow')}</div><h2>{t('newUI.comparisonPrompt')}</h2><p>{t('reports.emptyHelp')}</p></div><button type="button" className="button-primary" onClick={() => navigate('time-machine')}>{t('newUI.openEvidence')} <ArrowUpRight size={14} /></button></section>}
    <section className="panel report-search"><div><div className="eyebrow">{t('reports.new')}</div><h2>{t('reports.choose')}</h2><p>{t('reports.chooseHelp')}</p></div><form onSubmit={loadReport} className="report-form"><label>{t('reports.ra')}<input type="number" step="any" min="0" max="360" value={ra} onChange={(event) => setRa(event.target.value)} required /></label><label>{t('reports.dec')}<input type="number" step="any" min="-90" max="90" value={dec} onChange={(event) => setDec(event.target.value)} required /></label><button className="button-primary" disabled={loading}>{loading ? <span className="spinner" /> : <Search size={15} />}{loading ? t('reports.loading') : t('reports.build')}<ArrowUpRight size={14} /></button></form></section>
      {error && <div className="error-state report-error"><ShieldAlert size={17} /><div><b>{t('reports.errorTitle')}</b><span>{error}</span></div></div>}
      {noRecords && <div className="empty-state report-empty"><FileText size={21} /><b>{t('reports.noRecords')}</b><span>{t('reports.emptyHelp')}</span></div>}
      {loading && <div className="empty-state report-empty"><span className="spinner" /><b>{t('reports.loading')}</b></div>}
      {loaded && <section className="panel evidence-report"><div className="report-title"><div><div className="eyebrow">{t('reports.reportTitle')}</div><h2>{t('reports.region', { ra: Number(ra).toFixed(4), dec: Number(dec).toFixed(4) })}</h2></div><div className="report-actions"><span className="status-pill">{t('reports.metadataOnly')}</span><button type="button" className="button-secondary" onClick={() => window.print()}><FileText size={14} />{t('newUI.exportPdf')}</button></div></div>
        <div className="report-metrics"><ReportMetric label={t('reports.archiveRecords')} value={String(records.length)} /><ReportMetric label={t('reports.observationDates')} value={records.filter((row) => row.date).length ? [...new Set(records.map((row) => observationDateKey(row.date)).filter(Boolean))].join(', ') : t('reports.notAvailable')} /><ReportMetric label={t('reports.brightnessPosition')} value={t('reports.notMeasured')} /><ReportMetric label={t('reports.reviewStatus')} value={t('reports.notAnalyzed')} /></div>
        <div className="report-section"><h3>{t('reports.products')}</h3><p>{t('reports.productsHelp')}</p>{records.length ? <div className="report-record-list">{records.slice(0, 10).map((record, i) => <div key={`${record.accessUrl}-${i}`}><span>{record.target || record.raw.obs_id || t('reports.record', { number: i + 1 })}</span><small>{formatObservationDate(record.date) || t('reports.dateInFits')}</small><button type="button" onClick={() => setReportImage(record)}>{t('reports.openFits')} <ArrowUpRight size={12} /></button></div>)}</div> : <div className="empty-inline">{t('reports.noRecords')}</div>}
          {reportImage && <FitsProductViewer key={reportImage.accessUrl} observation={reportImage} compact />}
        </div>
        <div className="report-section"><h3>{t('reports.measured')}</h3><p>{t('reports.measuredHelp')}</p></div>
        <div className="report-section"><h3>{t('reports.interpretation')}</h3><p>{t('reports.interpretationHelp')}</p></div>
        <div className="citation-strip"><BadgeCheck size={15} /><span>{t('reports.source')} <a href="https://doi.org/10.26131/IRSA678" target="_blank" rel="noreferrer">10.26131/IRSA678</a></span><a href={IRSA_DOCS} target="_blank" rel="noreferrer">{t('reports.archiveGuide')} <ArrowUpRight size={13} /></a></div>
      </section>}
      {!loaded && !error && !noRecords && !loading && <div className="empty-state report-empty"><FileText size={21} /><b>{t('reports.emptyTitle')}</b><span>{t('reports.emptyHelp')}</span></div>}
    </div>
  )
}

function EvidenceComparisonReport({ evidence }: { evidence: ComparisonEvidence }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState<{ src: string; label: string } | null>(null)
  const [zoom, setZoom] = useState(1)
  const comparison = evidence.result
  const images = [
    { label: t('newUI.earlierImage'), src: comparison.images.earlier_png, date: evidence.earlierDate },
    { label: t('newUI.laterImage'), src: comparison.images.later_png, date: evidence.laterDate },
    { label: t('newUI.alignedDifference'), src: comparison.images.difference_png, date: comparison.earlier.band },
  ]
  return <section className="panel evidence-report comparison-evidence-report">
    <div className="report-title"><div><div className="eyebrow">{t('newUI.comparisonEyebrow')}</div><h2>{t('reports.region', { ra: evidence.ra.toFixed(4), dec: evidence.dec.toFixed(4) })}</h2></div>
      <button type="button" className="button-secondary" onClick={() => window.print()}><FileText size={14} />{t('newUI.exportPdf')}</button></div>
    <div className="comparison-date-row">
      <span>{t('newUI.earlierObservation')}: <b>{evidence.earlierDate || t('fits.notAvailable')}</b> · {comparison.earlier.observation_id}</span>
      <span>{t('newUI.laterObservation')}: <b>{evidence.laterDate || t('fits.notAvailable')}</b> · {comparison.later.observation_id}</span>
      <span>{t('newUI.bandLabel')}: <b>{comparison.earlier.band}</b></span>
      <span>{t('fits.coordinates')}: <b>{comparison.earlier.center_ra.toFixed(5)}°, {comparison.earlier.center_dec.toFixed(5)}°</b></span>
    </div>
    <div className="report-metrics">
      <ReportMetric label={t('newUI.countEarlier')} value={String(comparison.summary.earlier_detected)} />
      <ReportMetric label={t('newUI.countLater')} value={String(comparison.summary.later_detected)} />
      <ReportMetric label={t('newUI.countCommon')} value={String(comparison.summary.common)} />
      <ReportMetric label={t('newUI.countNew')} value={String(comparison.summary.new_candidates)} />
      <ReportMetric label={t('newUI.countMissing')} value={String(comparison.summary.not_detected_later)} />
      <ReportMetric label={t('newUI.countBrightness')} value={String(comparison.summary.brightness_candidates)} />
      <ReportMetric label={t('newUI.countPosition')} value={String(comparison.summary.position_candidates)} />
    </div>
    <div className="evidence-image-grid">{images.map((image) => <button type="button" className="evidence-image-card" key={image.label} onClick={() => { setZoom(1); setExpanded({ src: image.src, label: image.label }) }}>
      <img src={`data:image/png;base64,${image.src}`} alt={`${image.label} ${image.date}`} />
      <span><b>{image.label}</b><small>{image.date}</small></span>
    </button>)}</div>
    <div className="panel-title-row source-table-heading"><div><div className="eyebrow">{t('newUI.sourceTableEyebrow')}</div><h3>{t('newUI.sourceTableTitle', { count: Math.min(50, comparison.sources.length) })}</h3></div></div>
    {(comparison.sources.length > 50 || comparison.source_list_truncated) && <div className="clean-data-note">{t('newUI.sourceListNote', { count: Math.min(50, comparison.sources.length) })}</div>}
    <div className="table-scroll"><table className="source-table"><thead><tr><th>{t('newUI.objectId')}</th><th>{t('newUI.objectType')}</th><th>{t('newUI.earlierDetection')}</th><th>{t('newUI.laterDetection')}</th><th>{t('newUI.brightnessChange')}</th><th>{t('newUI.positionChange')}</th><th>{t('newUI.classification')}</th></tr></thead><tbody>
      {comparison.sources.slice(0, 50).map((source) => <tr key={source.id}>
        <td>{source.id}</td><td>{t('newUI.unclassifiedSource')}</td>
        <td>{source.earlier ? `${source.earlier.ra.toFixed(5)}°, ${source.earlier.dec.toFixed(5)}°` : '—'}</td>
        <td>{source.later ? `${source.later.ra.toFixed(5)}°, ${source.later.dec.toFixed(5)}°` : '—'}</td>
        <td>{source.brightness_percent === undefined ? '—' : `${source.brightness_percent.toFixed(1)}%`}</td>
        <td>{source.position_delta_arcsec === undefined ? '—' : `${source.position_delta_arcsec.toFixed(2)}″`}</td>
        <td>{t(`newUI.status.${source.status}`)}</td>
      </tr>)}
    </tbody></table></div>
    <p className="clean-data-note">{t('newUI.qualityNote')}</p>
    {expanded && <div className="evidence-image-overlay" role="dialog" aria-modal="true" aria-label={expanded.label}>
      <div className="evidence-image-overlay-toolbar"><strong>{expanded.label}</strong>
        <button type="button" className="icon-button" aria-label={t('fits.zoomOut')} onClick={() => setZoom((value) => Math.max(1, value / 1.25))}>−</button>
        <button type="button" className="icon-button" aria-label={t('fits.zoomIn')} onClick={() => setZoom((value) => Math.min(5, value * 1.25))}>+</button>
        <button type="button" className="icon-button" aria-label={t('fits.close')} onClick={() => setExpanded(null)}><X size={15} /></button>
      </div>
      <div className="evidence-image-overlay-view"><img src={`data:image/png;base64,${expanded.src}`} alt={expanded.label} style={{ transform: `scale(${zoom})` }} /></div>
    </div>}
  </section>
}
function ReportMetric({ label, value }: { label: string; value: string }) { return <div className="report-metric"><small>{label}</small><strong>{value}</strong></div> }

function LearnPage({ groups }: { groups: ImageGroup[] }) {
  const { t } = useTranslation()
  return (
    <div>
      <PageIntro eyebrow={t('learn.eyebrow')} title={t('nav.learn')} description={t('learn.description')} icon={BookOpen} />
      <section className="learn-banner"><div className="learn-banner-art"><div className="learn-orbit" /><div className="learn-core" /><span>0.75 — 5 μm</span></div><div><div className="eyebrow">{t('learn.fullName')}</div><h2>{t('learn.bannerTitle')}</h2><p>{t('learn.bannerText')}</p><a href="https://spherex.caltech.edu/" target="_blank" rel="noreferrer" className="text-button">{t('learn.exploreMission')} <ArrowUpRight size={14} /></a></div></section>
      <div className="learn-grid">
        <LearnCard number="01" title={t('learn.q1')} text={t('learn.a1')} icon={Telescope} />
        <LearnCard number="02" title={t('learn.q2')} text={t('learn.a2')} icon={Sparkles} />
        <LearnCard number="03" title={t('learn.q3')} text={t('learn.a3')} icon={Waves} />
        <LearnCard number="04" title={t('learn.q4')} text={t('learn.a4')} icon={Activity} />
        <LearnCard number="05" title={t('learn.q5')} text={t('learn.a5')} icon={ArrowLeftRight} />
        <LearnCard number="06" title={t('learn.q6')} text={t('learn.a6')} icon={Focus} />
      </div>
      <div className="section-heading compact-heading"><div><div className="eyebrow">{t('learn.cosmos')}</div><h2>{t('learn.referenceImages')}</h2></div></div>
      <div className="reference-grid">{groups.map((group) => <ReferenceCard key={group.label} group={group} compact />)}</div>
      <div className="notice-bar"><Info size={15} /><span>{t('learn.imagesNotice')}</span><a href="https://images.nasa.gov/" target="_blank" rel="noreferrer">{t('learn.nasaImages')} <ArrowUpRight size={13} /></a></div>
    </div>
  )
}
function LearnCard({ number, title, text, icon: Icon }: { number: string; title: string; text: string; icon: typeof Orbit }) {
  return <article className="learn-card"><div className="learn-card-top"><span>{number}</span><Icon size={19} /></div><h3>{title}</h3><p>{text}</p></article>
}

function AboutPage() {
  const { t } = useTranslation()
  return (
    <div>
      <PageIntro eyebrow={t('about.eyebrow')} title={t('nav.about')} description={t('about.description')} icon={CircleHelp} />
      <div className="about-grid"><section className="panel about-panel"><span className="stat-icon purple"><Orbit size={19} /></span><h2>{t('about.builtTitle')}</h2><p>{t('about.built1')}</p><p>{t('about.built2')}</p></section><section className="panel about-panel"><span className="stat-icon blue"><ShieldAlert size={19} /></span><h2>{t('about.limitsTitle')}</h2><p>{t('about.limits1')}</p><p>{t('about.limits2')}</p></section></div>
      <div className="section-heading compact-heading"><div><div className="eyebrow">{t('about.sources')}</div><h2>{t('about.followEvidence')}</h2></div></div>
      <div className="sources-list"><SourceRow title={t('about.dr1')} subtitle={t('about.dr1Sub')} url={IRSA_DOCS} /><SourceRow title={t('about.dataExplorer')} subtitle={t('about.dataExplorerSub')} url={IRSA_EXPLORER} /><SourceRow title={t('about.sia')} subtitle={t('about.siaSub')} url="https://irsa.ipac.caltech.edu/ibe/sia.html" /><SourceRow title={t('about.nasaApi')} subtitle={t('about.nasaApiSub')} url="https://images-api.nasa.gov/" /><SourceRow title={t('about.doi')} subtitle={t('about.doiSub')} url="https://doi.org/10.26131/IRSA678" /></div>
      <div className="citation-block"><strong>{t('about.ackTitle')}</strong><p>“{t('about.ackText')}”</p></div>
    </div>
  )
}
function SourceRow({ title, subtitle, url }: { title: string; subtitle: string; url: string }) {
  return <a className="source-row" href={url} target="_blank" rel="noreferrer"><span><b>{title}</b><small>{subtitle}</small></span><ArrowUpRight size={16} /></a>
}

export default App
