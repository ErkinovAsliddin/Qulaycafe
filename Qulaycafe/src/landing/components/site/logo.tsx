import { cn } from '../../lib/utils'

export function Logo({
  className,
  markClassName,
  textClassName,
}: {
  className?: string
  markClassName?: string
  textClassName?: string
}) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <span
        className={cn(
          'grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm',
          markClassName,
        )}
        aria-hidden="true"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M5 10h11v3a5 5 0 0 1-5 5H10a5 5 0 0 1-5-5v-3Z"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
          <path
            d="M16 11h1.5a2.5 2.5 0 0 1 0 5H16"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
          <path
            d="M9.5 6.5c0-1.2 1-1.8 1-3M12.5 6.5c0-1.2 1-1.8 1-3"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
        </svg>
      </span>
      <span
        className={cn(
          'text-[1.35rem] font-semibold tracking-tight text-foreground',
          textClassName,
        )}
      >
        Qulay<span className="text-primary">Cafe</span>
      </span>
    </span>
  )
}
