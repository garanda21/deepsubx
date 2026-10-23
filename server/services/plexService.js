import axios from 'axios';

const REQUEST_TIMEOUT_MS = 10000;

export function isConfigured() {
  return !!(process.env.PLEX_HOST && process.env.PLEX_PORT && process.env.PLEX_TOKEN);
}

export async function updateLibrary() {
  if (!isConfigured()) {
    throw new Error('Plex configuration is missing');
  }

  const baseUrl = `http://${process.env.PLEX_HOST}:${process.env.PLEX_PORT}`;
  try {
    // Send the token as a header so it never ends up in URLs or logs
    await axios.get(`${baseUrl}/library/sections/all/refresh`, {
      headers: { 'X-Plex-Token': process.env.PLEX_TOKEN },
      timeout: REQUEST_TIMEOUT_MS,
    });
  } catch (error) {
    const reason = error.response
      ? `HTTP ${error.response.status}`
      : error.code || error.message;
    console.error(`Failed to update Plex library at ${baseUrl}: ${reason}`);
    throw new Error(`Failed to update Plex library (${reason} at ${baseUrl})`, { cause: error });
  }
}
