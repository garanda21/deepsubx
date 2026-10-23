/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Injected at image build time (see Dockerfile and CI workflow)
  readonly VITE_APP_VERSION?: string;
  readonly VITE_APP_COMMIT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
