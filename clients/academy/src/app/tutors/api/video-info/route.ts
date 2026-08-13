export async function POST(req: Request) {
  try {
    const { url } = await req.json()

    // Extract video ID from YouTube URL
    const youtubeMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]+)/)

    if (youtubeMatch) {
      const videoId = youtubeMatch[1]

      // Use YouTube oEmbed API to get video info
      const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`

      const response = await fetch(oembedUrl)
      const data = await response.json()

      return Response.json({
        title: data.title,
        author: data.author_name,
        thumbnail: data.thumbnail_url,
        platform: "YouTube",
      })
    }

    // For other video platforms, return basic info
    return Response.json({
      title: "Video",
      platform: "Video Platform",
    })
  } catch (error) {
    console.error("Error fetching video info:", error)
    return Response.json({ error: "Could not fetch video information" }, { status: 500 })
  }
}
