import { Reveal } from './reveal'
import { MagneticButton } from './magnetic-button'
import { Img } from './img'
import { ArrowRight, Phone } from 'lucide-react'
import { PHONE_LABEL, PHONE_URL, TELEGRAM_URL, TRIAL_DAYS } from '../../lib/links'

export function CTA() {
  return (
    <section id="cta" className="relative py-20 sm:py-32">
      <div className="mx-auto max-w-[1600px] px-5 md:px-10">
        <Reveal>
          <div className="relative overflow-hidden rounded-[2rem] border border-border sm:rounded-[2.5rem]">
            <Img
              src="/images/cta-ambiance.webp"
              alt="Iliq yorug'likdagi restoran terrasasi"
              fill
              sizes="(max-width: 1024px) 100vw, 1200px"
              className="object-cover"
            />
            {/* On phones the copy sits over the middle of the photo, so the
                overlay runs top-to-bottom there and left-to-right from sm. */}
            <div className="absolute inset-0 bg-gradient-to-b from-foreground/80 via-foreground/70 to-foreground/60 sm:bg-gradient-to-r sm:from-foreground/80 sm:via-foreground/55 sm:to-foreground/25" />

            <div className="relative px-5 py-16 sm:px-16 sm:py-28">
              <div className="max-w-xl">
                <h2 className="text-balance font-serif text-3xl font-medium leading-tight tracking-tight text-background min-[400px]:text-4xl sm:text-5xl">
                  Restoraningizni bugun ulang
                </h2>
                <p className="mt-5 text-pretty text-lg leading-relaxed text-background/80">
                  {TRIAL_DAYS} kunlik bepul sinov. Karta talab qilinmaydi.
                  Menyuni ko&apos;chirib, QR kodlarni chiqarib beramiz — bir
                  kunda ishga tushadi.
                </p>

                <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                  <MagneticButton
                    href={TELEGRAM_URL}
                    external
                    className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-primary px-7 text-sm font-medium text-primary-foreground shadow-lg transition-colors hover:bg-primary/90"
                  >
                    Bepul sinovni boshlash
                    <ArrowRight className="h-4 w-4 shrink-0" strokeWidth={2} />
                  </MagneticButton>
                  <a
                    href={PHONE_URL}
                    className="inline-flex h-12 items-center justify-center gap-2 rounded-full border border-background/40 bg-background/10 px-7 text-sm font-medium text-background backdrop-blur transition-colors hover:bg-background/20"
                  >
                    <Phone className="h-4 w-4 shrink-0" strokeWidth={2} />
                    <span className="whitespace-nowrap">{PHONE_LABEL}</span>
                  </a>
                </div>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
