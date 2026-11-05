import type { ReactNode } from 'react'

function Svg({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

type P = { size?: number }
export const IconCalendar = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="5" width="17" height="15" rx="3" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </Svg>
)
export const IconNotes = (p: P) => (
  <Svg {...p}>
    <path d="M6 3.5h9l3.5 3.5v13.5H6z" />
    <path d="M9 11h6M9 15h6" />
  </Svg>
)
export const IconTag = (p: P) => (
  <Svg {...p}>
    <path d="M3.5 12.5V4.5h8l9 9-8 8z" />
    <circle cx="8" cy="9" r="1.2" />
  </Svg>
)
export const IconNews = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
    <path d="M7.5 9h9M7.5 12.5h9M7.5 16h5" />
  </Svg>
)
export const IconDash = (p: P) => (
  <Svg {...p}>
    <path d="M4 20V10M10 20V4M16 20v-7M21 20H3" />
  </Svg>
)
export const IconTrash = (p: P) => (
  <Svg {...p}>
    <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5M14 11v5" />
  </Svg>
)
export const IconGear = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" />
  </Svg>
)
export const IconSearch = (p: P) => (
  <Svg {...p}>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="m15.5 15.5 5 5" />
  </Svg>
)
export const IconPlus = (p: P) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
)
export const IconLeft = (p: P) => (
  <Svg {...p}>
    <path d="m14.5 5.5-6.5 6.5 6.5 6.5" />
  </Svg>
)
export const IconRight = (p: P) => (
  <Svg {...p}>
    <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />
  </Svg>
)
export const IconBold = (p: P) => (
  <Svg {...p}>
    <path d="M7 4.5h6a3.5 3.5 0 0 1 0 7H7zM7 11.5h7a3.5 3.5 0 0 1 0 8H7z" />
  </Svg>
)
export const IconItalic = (p: P) => (
  <Svg {...p}>
    <path d="M10 4.5h8M6 19.5h8M14.5 4.5l-5 15" />
  </Svg>
)
export const IconList = (p: P) => (
  <Svg {...p}>
    <path d="M9.5 6.5H20M9.5 12H20M9.5 17.5H20" />
    <circle cx="5" cy="6.5" r="1" />
    <circle cx="5" cy="12" r="1" />
    <circle cx="5" cy="17.5" r="1" />
  </Svg>
)
export const IconCheckList = (p: P) => (
  <Svg {...p}>
    <path d="m3.5 6.5 1.8 1.8 3-3.3M3.5 15.5l1.8 1.8 3-3.3M12 7h8.5M12 16h8.5" />
  </Svg>
)
export const IconLink = (p: P) => (
  <Svg {...p}>
    <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" />
  </Svg>
)
export const IconFolder = (p: P) => (
  <Svg {...p}>
    <path d="M3.5 7a2 2 0 0 1 2-2H10l2 2.5h6.5a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
  </Svg>
)
export const IconClose = (p: P) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
)
export const IconMin = (p: P) => (
  <Svg {...p}>
    <path d="M5 12h14" />
  </Svg>
)
export const IconMax = (p: P) => (
  <Svg {...p}>
    <rect x="5.5" y="5.5" width="13" height="13" rx="1.5" />
  </Svg>
)
export const IconChevronDown = (p: P) => (
  <Svg {...p}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
)
export const IconCheck = (p: P) => (
  <Svg {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Svg>
)
export const IconBolt = (p: P) => (
  <Svg {...p}>
    <path d="M13 3 5 14h6l-1 7 8-11h-6l1-7Z" />
  </Svg>
)
