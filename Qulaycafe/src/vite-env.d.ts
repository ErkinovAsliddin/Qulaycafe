/// <reference types="vite/client" />

// Compile-time contract for the build-time configuration this app reads.
// Anything not listed here still resolves (vite/client declares an index
// signature), but naming them documents what a deployment is expected to set
// and catches typos in the app code.
interface ImportMetaEnv {
  /** Base URL of the guest surface, e.g. https://clients.qulaycafe.uz — used
   *  for QR codes and shareable links generated inside the admin dashboard. */
  readonly VITE_CLIENTS_URL?: string;
  /** Base URLs of the two staff surfaces. The admin one is also what the
   *  marketing page's "Kirish" button points at. */
  readonly VITE_ADMIN_URL?: string;
  readonly VITE_KITCHEN_URL?: string;
  /** Sales contact shown on the marketing page — there is no self-service
   *  signup, so every CTA has to reach a human. Mirrors OWNER_CONTACT_*. */
  readonly VITE_CONTACT_TELEGRAM?: string;
  readonly VITE_CONTACT_PHONE?: string;
  /** Exact hostnames that map to a surface, comma separated. Only needed when
   *  a deployment does not use the <surface>.<domain> naming convention. */
  readonly VITE_ADMIN_HOSTS?: string;
  readonly VITE_KITCHEN_HOSTS?: string;
  readonly VITE_CLIENTS_HOSTS?: string;
  readonly VITE_LANDING_HOSTS?: string;
  /** "true" allows ?surface=admin|kitchen to override hostname resolution in
   *  production. Off by default — that override is a dev-only affordance. */
  readonly VITE_ALLOW_SURFACE_OVERRIDE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
