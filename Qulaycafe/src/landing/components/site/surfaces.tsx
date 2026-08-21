import { Reveal } from './reveal'
import { Globe, QrCode, ChefHat, ShieldCheck, ArrowUpRight } from 'lucide-react'
import {
  ADMIN_URL,
  CLIENTS_URL,
  KITCHEN_URL,
  LANDING_HOST,
  hostLabel,
} from '../../lib/links'

// The draft had three named customer testimonials and round numbers
// (500+ restoranlar, 2.4M+ buyurtma) that nobody had measured. This section
// explains something that is verifiably true instead: the system really is
// split across four hostnames, and src/utils/surface.ts is where that split
// is implemented.
const surfaces: {
  icon: typeof Globe
  host: string
  title: string
  desc: string
  href: string | null
  linkLabel?: string
}[] = [
  {
    icon: Globe,
    host: LANDING_HOST,
    title: 'Bu sahifa',
    desc: "Restoran egalari QulayCafe haqida shu yerda biladi. Ochiq sahifa — hech qanday parol yo'q.",
    href: null,
  },
  {
    icon: QrCode,
    host: hostLabel(CLIENTS_URL),
    title: 'Mehmon',
    desc: 'QR skanerlanganda ochiladi: menyu, savat, dostavka va bron. Admin va oshxona bo‘limlari bu yerda umuman yo‘q.',
    // No plain link: this surface is entered through a table's QR code, so a
    // bare visit has no restaurant or table context.
    href: null,
  },
  {
    icon: ChefHat,
    host: hostLabel(KITCHEN_URL),
    title: 'Oshxona',
    desc: "Faqat kelayotgan buyurtmalar. Oshpaz planshetida bir marta ochib qo'yiladi.",
    href: null,
  },
  {
    icon: ShieldCheck,
    host: hostLabel(ADMIN_URL),
    title: 'Egasi',
    desc: 'Menyu, narxlar, stollar, QR kodlar, hisobotlar va sozlamalar. Parol bilan kiriladi.',
    href: ADMIN_URL,
    linkLabel: 'Kirish',
  },
]

export function Surfaces() {
  return (
    <section id="tizim" className="relative border-t border-border/60 py-20 sm:py-32">
      <div className="mx-auto max-w-[1600px] px-5 md:px-10">
        <Reveal>
          <div className="mx-auto max-w-2xl text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
              To&apos;rt manzil, to&apos;rt ekran
            </span>
            <h2 className="mt-6 text-balance font-serif text-3xl font-medium leading-tight tracking-tight min-[400px]:text-4xl sm:text-5xl">
              Har kim faqat o&apos;ziga tegishlini ko&apos;radi
            </h2>
            <p className="mt-5 text-pretty text-lg leading-relaxed text-muted-foreground">
              Mehmon, oshpaz va restoran egasi uchun uchta alohida manzil. Bir
              ekrandagi tasodifiy bosish boshqasiga ta&apos;sir qilmaydi.
            </p>
          </div>
        </Reveal>

        <div className="mt-12 grid gap-4 sm:mt-16 sm:grid-cols-2 lg:grid-cols-4">
          {surfaces.map((s, i) => (
            <Reveal key={s.host + s.title} delay={i * 0.08}>
              <div className="flex h-full flex-col rounded-3xl border border-border bg-card p-5 shadow-[0_20px_60px_-45px_rgba(30,60,40,0.4)] sm:p-6">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <s.icon className="h-5 w-5" strokeWidth={1.5} />
                </div>
                <h3 className="mt-4 font-serif text-lg font-medium">{s.title}</h3>
                {/* break-all: the hostname is one long token and would push the
                    card wider than a 360px screen otherwise. */}
                <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                  {s.host}
                </p>
                <p className="mt-3 flex-1 text-pretty text-sm leading-relaxed text-muted-foreground">
                  {s.desc}
                </p>
                {s.href && (
                  <a
                    href={s.href}
                    className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-primary transition-colors hover:text-primary/80"
                  >
                    {s.linkLabel ?? 'Ochish'}
                    <ArrowUpRight className="h-4 w-4" strokeWidth={2} />
                  </a>
                )}
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
