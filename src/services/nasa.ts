export type NasaImage = {
  title: string
  description: string
  imageUrl: string
  nasaUrl: string
  date: string
}

type NasaItem = {
  data?: Array<{ title?: string; description?: string; date_created?: string }>
  links?: Array<{ href?: string; rel?: string; render?: string }>
}

export async function searchNasaImages(query: string, signal?: AbortSignal): Promise<NasaImage[]> {
  const params = new URLSearchParams({ q: query, media_type: 'image', page_size: '8' })
  const response = await fetch(`https://images-api.nasa.gov/search?${params}`, { signal })
  if (!response.ok) throw new Error(`NASA Images search failed (${response.status}).`)
  const payload = await response.json() as { collection?: { items?: NasaItem[] } }
  return (payload.collection?.items ?? []).flatMap((item) => {
    const metadata = item.data?.[0]
    const image = item.links?.find((link) => link.rel === 'preview' && link.href)
    if (!metadata?.title || !image?.href) return []
    return [{
      title: metadata.title,
      description: metadata.description ?? '',
      imageUrl: image.href,
      nasaUrl: image.href,
      date: metadata.date_created?.slice(0, 10) ?? '',
    }]
  })
}
