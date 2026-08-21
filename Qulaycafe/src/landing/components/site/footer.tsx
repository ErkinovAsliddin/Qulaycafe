import { Logo } from './logo'
import {
  ADMIN_URL,
  PHONE_LABEL,
  PHONE_URL,
  SECTIONS,
  TELEGRAM_URL,
  hostLabel,
} from '../../lib/links'

// Only destinations that exist. The draft listed a mobile app, a blog, careers,
// a knowledge base, an API reference and a status page — all of them `href="#"`.
//
// The "Sahifalar" column is the exception to "everything else is an in-page
// anchor": those four are real documents (public/*.html), and this column is
// what links them into the site. A page no page links to is a page Google has
// to be told about twice — and the shortcut list Google can show under a search
// result is built from a site's linked, separately-indexable URLs, which the
// anchors in the other columns are not.
type FooterLink = { label: string; href: string; external?: boolean }

const columns: { title: string; links: FooterLink[] }[] = [
  {
    title: 'Mahsulot',
    links: [
      { label: 'Imkoniyatlar', href: SECTIONS.features },
      { label: 'QR-menyu', href: SECTIONS.qrMenu },
      { label: 'Oshxona ekrani', href: SECTIONS.kitchen },
      { label: 'Dostavka', href: SECTIONS.delivery },
      { label: 'Analitika', href: SECTIONS.analytics },
    ],
  },
  {
    title: 'Tizim',
    links: [
      { label: "To'rt manzil", href: SECTIONS.surfaces },
      { label: 'Stollar', href: SECTIONS.tables },
      { label: 'Narxlar', href: SECTIONS.pricing },
      { label: 'Tizimga kirish', href: ADMIN_URL },
    ],
  },
  {
    title: 'Sahifalar',
    links: [
      { label: 'QulayCafe haqida', href: '/haqida' },
      { label: 'Narxlar va sinov', href: '/narxlar' },
      { label: 'Kirish', href: '/kirish' },
      { label: 'Aloqa', href: '/aloqa' },
    ],
  },
  {
    title: 'Aloqa',
    links: [
      { label: 'Telegram', href: TELEGRAM_URL, external: true },
      { label: PHONE_LABEL, href: PHONE_URL },
      { label: 'Demoga yozilish', href: TELEGRAM_URL, external: true },
    ],
  },
]

export function Footer() {
  return (
    <footer className="border-t border-border/60 bg-card">
      <div className="mx-auto max-w-[1600px] px-5 py-14 md:px-10 sm:py-16">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-6 lg:gap-12">
          <div className="lg:col-span-2">
            <Logo />
            <p className="mt-5 max-w-xs text-pretty text-sm leading-relaxed text-muted-foreground">
              QulayCafe — restoran va kafelar uchun QR-menyu, oshxona ekrani,
              dostavka va hisobotlar. Hammasi bitta tizimda.
            </p>
            <p className="mt-4 break-all font-mono text-xs text-muted-foreground">
              {hostLabel(ADMIN_URL)}
            </p>
          </div>

          {columns.map((col) => (
            <div key={col.title}>
              <h3 className="text-sm font-medium">{col.title}</h3>
              <ul className="mt-4 space-y-3">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      {...(link.external
                        ? { target: '_blank', rel: 'noreferrer noopener' }
                        : {})}
                      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-border pt-8 sm:flex-row">
          <p className="text-center text-sm text-muted-foreground sm:text-left">
            &copy; {new Date().getFullYear()} QulayCafe. Barcha huquqlar himoyalangan.
          </p>
          <a
            href={TELEGRAM_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Savol bormi? Yozing
          </a>
        </div>
      </div>
    </footer>
  )
}
