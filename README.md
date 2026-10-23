
# DeepSubX

DeepSubX is a Dockerized application that uses the DeepL API to translate subtitles for TV shows and movies in your library. Additionally, it can extract embedded subtitles from video files and translate them into the desired language. 

The application offers optional integration with a Plex server, allowing you to update your Plex library automatically once the subtitles are translated.

![CleanShot 2024-12-31 at 11 55 21@2x](https://github.com/user-attachments/assets/908c2459-608b-4a5a-b772-ae5bc78b50a8)

---

## Features

- Translate subtitles for TV shows and movies using DeepL.
- Extract embedded subtitles and translate them.
- Optional Plex server integration for automatic library updates.

---

## Requirements

1. Docker installed on your system.
2. A DeepL API key.
3. Mapped directories for movies and TV shows:
   - `./data:/data`
   - `./movies:/movies`
4. Optional: Plex host, port, and token for library updates.

---

## Folder Structure

- **Movies:** Each movie should be in its folder.  
  Example:  
  ```
  /movies
    /Movie 1
      file1.mkv
      file1.srt
    /Movie 2
      file2.mkv
      file2.srt
  ```
  
- **TV Shows:** Organized into show and season folders.  
  Example:  
  ```
  /TV Show
    /Season 1
      episode1.mkv
      episode1.srt
  ```

---

## Environment Variables

| Variable       | Description                               | Required |
|----------------|-------------------------------------------|----------|
| `TRANSLATION_PROVIDER` | Translation engine: `deepl` (default) or `llm` | Optional |
| `DEEPL_API_KEY` | Your DeepL API key                        | Yes, with `deepl` |
| `LLM_BASE_URL`  | OpenAI-compatible API base URL (default `https://api.openai.com/v1`) | Optional |
| `LLM_API_KEY`   | API key for the LLM endpoint              | Yes, with `llm` (except local servers) |
| `LLM_MODEL`     | Model name, e.g. `gpt-4.1`, `anthropic/claude-sonnet-5-5` | Yes, with `llm` |
| `LLM_FALLBACK_MODELS` | Comma-separated models tried in order when `LLM_MODEL` keeps failing | Optional |
| `LLM_BATCH_SIZE` | Subtitles per request (default `25`)     | Optional |
| `LLM_CONTEXT_SIZE` | Previous lines sent as context (default `5`) | Optional |
| `LLM_CONCURRENCY` | Parallel requests (default `3`)         | Optional |
| `LLM_MAX_RETRIES` | Retries for rate limits and server errors (default `5`) | Optional |
| `LLM_TEMPERATURE` | Sampling temperature (default `0.2`)    | Optional |
| `LLM_JSON_MODE` | Send `response_format: json_object`; set `false` if your endpoint rejects it (default `true`) | Optional |
| `LLM_PROMPT_FILE` | Path to a custom system prompt (default `/config/llm-system-prompt.txt`) | Optional |
| `PLEX_HOST`     | Plex server hostname or IP address         | Optional |
| `PLEX_PORT`     | Plex server port                          | Optional |
| `PLEX_TOKEN`    | Plex API token                            | Optional |

---

## How to Get a DeepL API Key

1. Visit [DeepL's website](https://www.deepl.com/pro-api).
2. Sign up for an account or log in.
3. Navigate to the API section and generate an API key.
4. Copy the key and use it in the `DEEPL_API_KEY` environment variable.

---

## Using an LLM Instead of DeepL

Set `TRANSLATION_PROVIDER=llm` to translate with any OpenAI-compatible chat API. The SRT
file is parsed on the server and only the subtitle text is sent to the model, so timestamps
and numbering are never altered.

| Provider | `LLM_BASE_URL` | `LLM_MODEL` example |
|----------|----------------|---------------------|
| OpenAI | `https://api.openai.com/v1` | `gpt-4.1` |
| OpenRouter | `https://openrouter.ai/api/v1` | `anthropic/claude-sonnet-5-5` |
| Anthropic (OpenAI SDK compatibility) | `https://api.anthropic.com/v1` | `claude-sonnet-5-5` |
| LiteLLM proxy | `http://litellm:4000/v1` | any model configured in LiteLLM |
| Ollama | `http://ollama:11434/v1` | `qwen2.5:14b` |

### Fallback models and resuming

Free models often fail with rate limits or provider errors. Set `LLM_FALLBACK_MODELS` to a
comma-separated list of models to try in order; a model that fails over is skipped for the
next 5 minutes. Translations run as background jobs, and if a job still fails, the
**Resume translation** button continues from the last finished batch instead of starting over.

```env
LLM_MODEL=google/gemma-4-26b-a4b-it:free
LLM_FALLBACK_MODELS=nvidia/nemotron-3.5-super-vl:free,dots-studio/dots-3-note-preview:free
```

### Custom system prompt

The bundled prompt lives in [`server/prompts/llm-system-prompt.txt`](server/prompts/llm-system-prompt.txt).
To use your own, mount a file at `/config/llm-system-prompt.txt` (or point `LLM_PROMPT_FILE`
elsewhere). It is read on every translation, so changes apply without restarting. The
placeholders `{{SOURCE_LANG}}` and `{{TARGET_LANG}}` are replaced with the language names, and
the model must answer with `{"items":[{"i":<id>,"t":"<translation>"}]}`.

```yaml
volumes:
  - ./llm-system-prompt.txt:/config/llm-system-prompt.txt:ro
```

---

## How to Get a Plex Token

1. Open your Plex server in a browser and log in.
2. Right-click anywhere on the page and select "Inspect" (or press `Ctrl+Shift+I`).
3. Go to the "Network" tab and reload the page.
4. Search for `X-Plex-Token` in the request headers.
5. Copy the token and use it in the `PLEX_TOKEN` environment variable.

For detailed instructions, refer to the official [Plex Token Documentation](https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/).

---

## Running the Application

1. Clone the repository:
   ```bash
   git clone https://github.com/garanda21/deepsubx.git
   ```
2. Navigate to the project directory:
   ```bash
   cd deepsubx
   ```
3. Set up the `.env` file with the required variables:
   ```env
   DEEPL_API_KEY=<your_deepl_api_key>
   # Or, to use an LLM:
   # TRANSLATION_PROVIDER=llm
   # LLM_BASE_URL=https://openrouter.ai/api/v1
   # LLM_API_KEY=<your_llm_api_key>
   # LLM_MODEL=anthropic/claude-sonnet-5-5
   PLEX_HOST=<optional_plex_host>
   PLEX_PORT=<optional_plex_port>
   PLEX_TOKEN=<optional_plex_token>
   ```
4. Start the application with Docker Compose:
   ```bash
   docker-compose up --build
   ```
5. Optionally you can use the `docker-compose.yml` at the root of the project
---

## Optional Plex Integration

If configured, DeepSubX can notify Plex to update its library after subtitles are translated. This step is optional and does not affect the main functionality.

---

## Tech Stack

- **Frontend:** Vite, React, Tailwind CSS
- **Backend:** Node.js
- **Containerization:** Docker

---

## License

This project is licensed under the [MIT License](LICENSE).

---

## Contributing

Contributions are welcome! Please open an issue or submit a pull request for any improvements or fixes.
