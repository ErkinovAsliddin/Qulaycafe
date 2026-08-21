import { Reveal } from './reveal'
import {
  QrCode,
  ChefHat,
  LayoutGrid,
  BarChart3,
  Warehouse,
  CalendarCheck,
  Bike,
  Palette,
} from 'lucide-react'

// Every card here maps to a module that actually ships in the admin panel —
// the design draft also listed a staff-management module and an online
// payment gateway, neither of which exists.
const features = [
  {
    icon: QrCode,
    title: 'QR-menyu va buyurtma',
    desc: "Mehmon telefonidan ko'radi, tanlaydi va to'g'ridan-to'g'ri buyurtma beradi. Menyu uch tilda.",
    big: true,
  },
  { icon: ChefHat, title: 'Oshxona ekrani', desc: 'Buyurtmalar avtomatik oshxonaga tushadi.' },
  { icon: LayoutGrid, title: 'Stollar xaritasi', desc: 'Butun zal holati real vaqtda.' },
  {
    icon: BarChart3,
    title: 'Analitika',
    desc: "Tushum, eng ko'p sotilganlar, to'lov usullari va buyurtma turlari — Excel'ga yuklab olinadi.",
    big: true,
  },
  { icon: Warehouse, title: 'Ombor nazorati', desc: "Mahsulot qoldig'i avtomatik hisoblanadi." },
  { icon: CalendarCheck, title: 'Bron qilish', desc: 'Stol broni Telegram bot orqali qabul qilinadi.' },
  { icon: Bike, title: 'Dostavka', desc: "Buyurtma kuryerga Telegram'da manzil bilan boradi." },
  { icon: Palette, title: 'Brending', desc: "Logotip, rang va menyu ko'rinishi — o'zingizcha." },
]

export function Ecosystem() {
  return (
    <section id="imkoniyatlar" className="relative border-t border-border/60 py-20 sm:py-32">
      <div className="mx-auto max-w-[1600px] px-5 md:px-10">
        <Reveal>
          <div className="mx-auto max-w-2xl text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Yagona ekotizim
            </span>
            <h2 className="mt-6 text-balance font-serif text-3xl font-medium leading-tight tracking-tight min-[400px]:text-4xl sm:text-5xl">
              Restoraningiz uchun kerak bo&apos;lgan hamma narsa
            </h2>
            <p className="mt-5 text-pretty text-lg leading-relaxed text-muted-foreground">
              Bir nechta dastur o&apos;rniga — bitta, uzviy bog&apos;langan tizim.
            </p>
          </div>
        </Reveal>

        <div className="mt-12 grid grid-cols-2 gap-3 sm:mt-16 sm:gap-4 md:grid-cols-4">
          {features.map((f, i) => (
            <Reveal
              key={f.title}
              delay={i * 0.05}
              className={f.big ? 'col-span-2' : 'col-span-1'}
            >
              <div className="group flex h-full flex-col rounded-2xl border border-border bg-card p-4 transition-all duration-300 hover:-translate-y-1 hover:border-primary/30 hover:shadow-[0_20px_50px_-30px_rgba(30,60,40,0.4)] sm:p-6">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground sm:h-11 sm:w-11">
                  <f.icon className="h-5 w-5" strokeWidth={1.5} />
                </div>
                <h3 className="mt-4 font-serif text-base font-medium sm:mt-5 sm:text-lg">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
