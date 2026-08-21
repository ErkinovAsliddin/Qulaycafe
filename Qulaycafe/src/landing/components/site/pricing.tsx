import { Reveal } from './reveal'
import { Check, MessageCircle, Phone } from 'lucide-react'
import {
  ANNUAL_MONTHS,
  EXTRA_BRANCH_PRICE,
  PHONE_LABEL,
  PHONE_URL,
  PLANS,
  SETUP_FEE,
  TELEGRAM_URL,
  TRIAL_DAYS,
  somLabel,
} from '../../lib/links'

// Three named prices, which this section used to refuse to give. What makes
// them real is that the panel already has per-restaurant module switches:
// restaurants.delivery_status / reservation_status / loyalty_status, flipped
// from the owner Telegram bot and honoured by both the API middleware and the
// admin/guest UI. A tier is just a recipe of those three switches.
//
// The table counts and the extra-branch line are NOT enforced anywhere in the
// code — they are a sales agreement kept by hand, so nothing here counts tables
// and refuses the eleventh. Prices live in lib/links.ts with the rest of the
// numbers the page shows.

export function Pricing() {
  return (
    <section
      id="narxlar"
      className="relative border-t border-border/60 bg-secondary/40 py-20 sm:py-32"
    >
      <div className="mx-auto max-w-[1600px] px-5 md:px-10">
        <Reveal>
          <div className="mx-auto max-w-2xl text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Narxlar
            </span>
            <h2 className="mt-6 text-balance font-serif text-3xl font-medium leading-tight tracking-tight min-[400px]:text-4xl sm:text-5xl">
              Uchta tarif — restoraningizga qarab tanlaysiz
            </h2>
            <p className="mt-5 text-pretty text-lg leading-relaxed text-muted-foreground">
              Yashirin to&apos;lovlar yo&apos;q. Tarifni keyin ham
              o&apos;zgartirasiz — bo&apos;limlar bir buyruq bilan yoqiladi,
              ma&apos;lumotlaringiz joyida qoladi.
            </p>
          </div>
        </Reveal>

        <div className="mt-12 grid gap-4 sm:mt-16 sm:grid-cols-2 lg:grid-cols-3">
          {PLANS.map((plan, i) => (
            <Reveal key={plan.id} delay={0.1 + i * 0.08}>
              <div
                className={
                  plan.popular
                    ? 'flex h-full flex-col rounded-3xl border border-primary/40 bg-card p-5 shadow-[0_40px_100px_-50px_rgba(30,60,40,0.55)] sm:p-8'
                    : 'flex h-full flex-col rounded-3xl border border-border bg-card p-5 sm:p-8'
                }
              >
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-serif text-xl font-medium">{plan.name}</h3>
                  {plan.popular && (
                    <span className="inline-flex w-fit shrink-0 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                      Ommabop
                    </span>
                  )}
                </div>

                <p className="mt-4 font-serif text-4xl font-medium leading-none">
                  {somLabel(plan.price)}
                  <span className="ml-2 align-baseline text-base font-sans font-normal text-muted-foreground">
                    so&apos;m / oy
                  </span>
                </p>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  {plan.audience}
                </p>

                <ul className="mt-6 grid flex-1 gap-3">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-3 text-sm">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" strokeWidth={2.5} />
                      <span className="text-pretty text-foreground/90">{f}</span>
                    </li>
                  ))}
                </ul>

                <a
                  href={TELEGRAM_URL}
                  target="_blank"
                  rel="noreferrer noopener"
                  className={
                    plan.popular
                      ? 'mt-8 inline-flex h-12 items-center justify-center gap-2 rounded-full bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90'
                      : 'mt-8 inline-flex h-12 items-center justify-center gap-2 rounded-full border border-border px-6 text-sm font-medium transition-colors hover:bg-secondary'
                  }
                >
                  <MessageCircle className="h-4 w-4" strokeWidth={2} />
                  {plan.name}&apos;ni tanlash
                </a>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={0.3}>
          <p className="mt-6 text-pretty text-center text-sm leading-relaxed text-muted-foreground">
            Narxlar oyiga, QQS hisobga olinmagan. Bir martalik sozlash —{' '}
            <span className="font-medium text-foreground/90">
              {somLabel(SETUP_FEE)} so&apos;m
            </span>{' '}
            (menyuni kiritamiz, rasmlarni joylashtiramiz, QR kodlarni chiqarib
            beramiz, xodimlarni o&apos;qitamiz). Yillik to&apos;lovda{' '}
            <span className="font-medium text-foreground/90">
              {ANNUAL_MONTHS} oy puli
            </span>{' '}
            — 2 oy bepul. Qo&apos;shimcha filial —{' '}
            <span className="font-medium text-foreground/90">
              +{somLabel(EXTRA_BRANCH_PRICE)} so&apos;m / oy
            </span>
            .
          </p>
        </Reveal>

        <Reveal delay={0.35}>
          <div className="mt-8 flex flex-col gap-6 rounded-3xl border border-primary/40 bg-card p-5 sm:p-8 lg:flex-row lg:items-center lg:justify-between">
            <div className="lg:max-w-2xl">
              <span className="inline-flex w-fit rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                Sinov
              </span>
              <p className="mt-4 font-serif text-3xl font-medium leading-none sm:text-4xl">
                {TRIAL_DAYS} kun bepul
              </p>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                Karta talab qilinmaydi va o&apos;zi to&apos;lovga o&apos;tib
                ketmaydi. Yozing yoki qo&apos;ng&apos;iroq qiling — menyuni
                ko&apos;chirib, stollarga QR kodlar chiqarib beramiz va sinov shu
                kuni boshlanadi. Qaysi tarif kerakligini sinovdan keyin
                hal qilasiz.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row lg:shrink-0 lg:flex-col">
              <a
                href={TELEGRAM_URL}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <MessageCircle className="h-4 w-4" strokeWidth={2} />
                Telegram&apos;da yozish
              </a>
              <a
                href={PHONE_URL}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-full border border-border px-6 text-sm font-medium transition-colors hover:bg-secondary"
              >
                <Phone className="h-4 w-4" strokeWidth={2} />
                <span className="whitespace-nowrap">{PHONE_LABEL}</span>
              </a>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
