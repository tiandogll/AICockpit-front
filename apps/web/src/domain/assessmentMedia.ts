export type AssessmentImage = {
  src: string
  alt: string
  caption?: string
}

export type AssessmentMedia = {
  images: AssessmentImage[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Canonical root-relative paths only: no external origin, URL parameters,
// encoded separators, traversal, or backslashes reach the browser's image loader.
const localImagePath =
  /^\/assessment-media\/(?:[a-z0-9_-]+\/)*[a-z0-9_-][a-z0-9_.-]*\.(?:svg|png|jpe?g|webp)$/i

export function parseAssessmentMedia(value: unknown): {
  images: AssessmentImage[]
  hasRejectedImages: boolean
} {
  if (value === undefined || value === null || (Array.isArray(value) && value.length === 0))
    return { images: [], hasRejectedImages: false }
  if (!isRecord(value) || !Array.isArray(value.images)) {
    return { images: [], hasRejectedImages: true }
  }

  const images: AssessmentImage[] = []
  let hasRejectedImages = false
  for (const candidate of value.images) {
    if (
      !isRecord(candidate) ||
      typeof candidate.src !== 'string' ||
      candidate.src !== candidate.src.trim() ||
      !localImagePath.test(candidate.src) ||
      typeof candidate.alt !== 'string' ||
      !candidate.alt.trim()
    ) {
      hasRejectedImages = true
      continue
    }
    const caption = typeof candidate.caption === 'string' ? candidate.caption.trim() : ''
    images.push({
      src: candidate.src,
      alt: candidate.alt.trim(),
      ...(caption ? { caption } : {}),
    })
  }
  return { images, hasRejectedImages }
}
