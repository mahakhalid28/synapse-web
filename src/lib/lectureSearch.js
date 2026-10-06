// TODO: swap for real GET /video/search?q= once the YouTube API is connected.
export async function searchVideos(query) {
  await new Promise((r) => setTimeout(r, 500));
  return [
    {
      videoId: "NFZtjSeT3XE",
      title: `${query} — full lecture`,
      channel: "MIT OpenCourseWare",
      duration: "24:10",
    },
    {
      videoId: "dQw4w9WgXcQ",
      title: `Understanding ${query}`,
      channel: "Professor Dave Explains",
      duration: "15:47",
    },
  ];
}

export function extractYouTubeId(raw) {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const patterns = [
    /(?:youtube\.com\/watch\?(?:.*&)?v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const re of patterns) {
    const match = trimmed.match(re);
    if (match?.[1]) return match[1];
  }
  return null;
}
