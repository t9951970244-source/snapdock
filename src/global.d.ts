import type { SnapApi } from '../electron/preload'
declare global { interface Window { snap?: SnapApi } }
export {}
