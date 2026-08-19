/**
 * The icon registry.
 *
 * Call sites ask for a *concept* (`icons.mailbox.inbox`), never for a lucide
 * export. That indirection is the whole point: lucide renames icons across
 * majors — `AlertCircle` became `CircleAlert`, `MoreVertical` became
 * `EllipsisVertical` — and with 300 direct imports scattered through the app a
 * rename is a day of grep. Here it is one line, and `icons.spec.ts` fails the
 * build if any entry stops resolving.
 *
 * Verified against lucide-react 1.33.0 on 2026-08-19: 243 of the 244 names in
 * the icon catalog resolve. The one that did not, `Pulse`, was only ever listed
 * as an alternative spelling of `Activity`, which is what is used below.
 */

import {
  Accessibility, Activity, AlertCircle, AlertOctagon, AlertTriangle, AlignCenter,
  AlignJustify, AlignLeft, AlignRight, Archive, ArrowDown, ArrowLeft, ArrowUp,
  ArrowUpDown, AtSign, BadgeCheck, Ban, Bell, BellOff, Bold, BookUser, Bookmark,
  Bot, BrainCircuit, Briefcase, Building, Building2, Calendar, CalendarCheck2,
  CalendarClock, CalendarDays, CalendarPlus, Captions, Check, CheckCheck,
  CheckCircle2, CheckSquare, ChevronDown, ChevronLeft, ChevronRight, ChevronUp,
  ChevronsLeft, ChevronsRight, ChevronsUpDown, CircleDot, CircleHelp, CircleUser,
  Clipboard, Clock, ClockAlert, Cloud, CloudDownload, Code, CodeXml, Columns,
  Command, Contact, ContactRound, Contrast, Copy, CornerDownRight, CornerUpLeft,
  CornerUpRight, Cpu, Crown, Database, Download, ExternalLink, Eye, EyeOff, File,
  FileArchive, FileAudio, FileCheck, FileCode2, FileImage, FileJson, FileKey,
  FileSpreadsheet, FileText, FileVideo, Filter, FilterX, Fingerprint, Flame,
  Folder, FolderInput, FolderOpen, FolderPlus, Forward, Gauge, Globe, GlobeLock,
  GripHorizontal, GripVertical, HardDrive, Hash, Heading1, Heading2, Heading3,
  HelpCircle, Highlighter, History, Image, ImagePlus, Inbox, Indent, Info, Italic,
  Key, KeyRound, Keyboard, Languages, Laptop, LayoutGrid, LayoutList, Lightbulb,
  Link, Link2, List, ListCollapse, ListOrdered, ListTodo, Loader2, Lock, LockOpen,
  LogIn, LogOut, Mail, MailCheck, MailOpen, MailPlus, MailSearch, MailWarning,
  MailX, Mails, MapPin, Maximize, Maximize2, MemoryStick, Menu, Merge, Minimize2,
  Minus, Monitor, Moon, MoreHorizontal, MoreVertical, MoveRight, Music, Newspaper,
  Outdent, Palette, Paperclip, PauseCircle, PenSquare, Percent, Phone, Pin,
  PlayCircle, Plus, Presentation, Printer, QrCode, Radio, Receipt, ReceiptText, Redo2,
  RefreshCw, RemoveFormatting, Repeat, Reply, ReplyAll, RotateCcw, Router,
  ScanFace, ScrollText, Search, SearchX, Send, SendHorizontal,
  SeparatorHorizontal, Server, ServerCrash, ServerOff, Settings, Settings2,
  Share2, Shield, ShieldAlert, ShieldBan, ShieldCheck, ShieldOff, ShieldX,
  Signature, SlidersHorizontal, Smartphone, Smile, SmilePlus, Sparkles, Plug,
  SpellCheck, Split, Square, Stamp, Star, Strikethrough, Subscript, Sun,
  Superscript, Table, Tablet, Tag, Tags, Terminal, TextQuote, Trash2, TrendingDown,
  TrendingUp, Type, Underline, Undo2, Unlink, Upload, UserCheck, UserCog,
  UserMinus, UserPlus, UserX, Users, Video, Volume2, VolumeX, Wand2, Wifi,
  WifiOff, Workflow, Wrench, X, ZoomIn, ZoomOut,
  type LucideIcon,
} from "lucide-react";

export type { LucideIcon };

/** Category 1 — mailbox navigation and system folders. */
export const mailbox = {
  inbox: Inbox,
  sent: SendHorizontal,
  drafts: PenSquare,
  archive: Archive,
  snoozed: Clock,
  starred: Star,
  important: Bookmark,
  spam: Flame,
  trash: Trash2,
  allMail: Mails,
  done: CheckCheck,
  smartTriage: Sparkles,
  screenerAllowed: UserCheck,
  screenerBlocked: UserX,
  feed: Newspaper,
  paperTrail: ReceiptText,
  pinned: Pin,
  replyLater: CornerDownRight,
  label: Tag,
  labels: Tags,
  folder: Folder,
  folderOpen: FolderOpen,
  folderNew: FolderPlus,
  sharedInbox: Users,
  outbox: Radio,
} as const;

/** Category 2 — message list item states. */
export const messageState = {
  unread: Mail,
  read: MailOpen,
  compose: MailPlus,
  delivered: MailCheck,
  deliveryWarning: MailWarning,
  deliveryFailed: MailX,
  searchMailbox: MailSearch,
  attachment: Paperclip,
  encrypted: Lock,
  insecure: LockOpen,
  replied: CornerUpLeft,
  forwarded: CornerUpRight,
  checkboxOff: Square,
  checkboxOn: CheckSquare,
  unreadDot: CircleDot,
  calendarInvite: Calendar,
} as const;

/** Category 3 — thread actions. */
export const threadAction = {
  reply: Reply,
  replyAll: ReplyAll,
  forward: Forward,
  delete: Trash2,
  archive: Archive,
  snooze: Clock,
  move: FolderInput,
  label: Tag,
  print: Printer,
  export: Download,
  openExternal: ExternalLink,
  reportPhishing: ShieldAlert,
  blockSender: Ban,
  unsubscribe: ShieldBan,
  viewSource: FileCode2,
  translate: Languages,
  readAloud: Volume2,
  mute: VolumeX,
  moreVertical: MoreVertical,
  moreHorizontal: MoreHorizontal,
  expandAll: ChevronsUpDown,
} as const;

/** Category 4 — composer and rich-text toolbar. */
export const editor = {
  bold: Bold,
  italic: Italic,
  underline: Underline,
  strikethrough: Strikethrough,
  subscript: Subscript,
  superscript: Superscript,
  h1: Heading1,
  h2: Heading2,
  h3: Heading3,
  fontFamily: Type,
  textColor: Palette,
  highlight: Highlighter,
  clearFormatting: RemoveFormatting,
  alignLeft: AlignLeft,
  alignCenter: AlignCenter,
  alignRight: AlignRight,
  alignJustify: AlignJustify,
  bulletList: List,
  orderedList: ListOrdered,
  taskList: ListTodo,
  indent: Indent,
  outdent: Outdent,
  blockquote: TextQuote,
  inlineCode: Code,
  codeBlock: CodeXml,
  table: Table,
  divider: SeparatorHorizontal,
  link: Link2,
  unlink: Unlink,
  attach: Paperclip,
  image: ImagePlus,
  emoji: SmilePlus,
  signature: Signature,
  template: FileText,
  scheduling: CalendarPlus,
  confidential: EyeOff,
  encrypt: Lock,
  scheduleSend: ClockAlert,
  fullscreen: Maximize2,
  dock: Minimize2,
  undo: Undo2,
  redo: Redo2,
} as const;

/** Category 5 — AI assistance. */
export const ai = {
  assistant: Sparkles,
  polish: Wand2,
  actionItems: BrainCircuit,
  summarize: ListCollapse,
  tone: Gauge,
  followUp: Lightbulb,
  translate: Languages,
  spellCheck: SpellCheck,
  autoResponder: Bot,
  smartReply: SendHorizontal,
} as const;

/** Category 6 — search, filters, command palette. */
export const search = {
  search: Search,
  clear: SearchX,
  advanced: SlidersHorizontal,
  filter: Filter,
  clearFilters: FilterX,
  dateRange: Calendar,
  hasAttachment: Paperclip,
  address: AtSign,
  starred: Star,
  unread: Mail,
  verifiedOnly: ShieldCheck,
  label: Tag,
  sort: ArrowUpDown,
  sortAsc: ArrowUp,
  sortDesc: ArrowDown,
  history: History,
  command: Command,
  close: X,
} as const;

/** Category 7 — contacts. */
export const contacts = {
  card: ContactRound,
  directory: BookUser,
  add: UserPlus,
  remove: UserMinus,
  verified: UserCheck,
  edit: UserCog,
  company: Building2,
  role: Briefcase,
  phone: Phone,
  email: Mail,
  address: MapPin,
  website: Globe,
  tag: Tag,
  merge: Merge,
  import: Upload,
  export: Download,
  vip: Star,
  contact: Contact,
} as const;

/** Category 8 — calendar and scheduling. */
export const calendar = {
  view: Calendar,
  agenda: CalendarDays,
  create: CalendarPlus,
  proposeTime: CalendarClock,
  confirmed: CalendarCheck2,
  video: Video,
  location: MapPin,
  attendees: Users,
  recurring: Repeat,
  allDay: Sun,
  accept: Check,
  decline: X,
  tentative: HelpCircle,
  newTime: Split,
  timezone: Globe,
} as const;

/** Category 9 — attachment file types, keyed by broad MIME family. */
export const fileType = {
  generic: File,
  text: FileText,
  spreadsheet: FileSpreadsheet,
  presentation: Presentation,
  image: FileImage,
  video: FileVideo,
  audio: FileAudio,
  archive: FileArchive,
  code: FileJson,
  certificate: FileKey,
  pdf: Receipt,
  download: CloudDownload,
  preview: Eye,
  cloud: Cloud,
  copyLink: Copy,
  imageInline: Image,
  music: Music,
} as const;

/** Category 10 — security and authentication. */
export const security = {
  verified: ShieldCheck,
  partial: ShieldAlert,
  spoofed: ShieldX,
  unconfigured: ShieldOff,
  tls: Lock,
  plaintext: LockOpen,
  pgpKey: KeyRound,
  passkey: Fingerprint,
  biometric: ScanFace,
  totp: QrCode,
  smime: FileCheck,
  trackerBlocked: EyeOff,
  geoFence: GlobeLock,
  deviceDesktop: Laptop,
  deviceMobile: Smartphone,
  revokeSession: LogOut,
  auditLog: ScrollText,
  shield: Shield,
  key: Key,
} as const;

/** Category 11 — server and queue operations. */
export const infra = {
  server: Server,
  serverDown: ServerCrash,
  serverOff: ServerOff,
  cpu: Cpu,
  memory: MemoryStick,
  disk: HardDrive,
  health: Activity,
  database: Database,
  routing: Router,
  inboundQueue: Inbox,
  outboundQueue: Send,
  pause: PauseCircle,
  resume: PlayCircle,
  retry: RotateCcw,
  purge: Trash2,
  logs: Terminal,
  maintenance: Wrench,
  refresh: RefreshCw,
} as const;

/** Category 12 — DNS and deliverability. */
export const dns = {
  zone: Globe,
  mx: Server,
  txt: FileText,
  cname: Share2,
  aRecord: Radio,
  ptr: CornerUpLeft,
  reputation: Gauge,
  improving: TrendingUp,
  degrading: TrendingDown,
  blacklisted: AlertOctagon,
  warmup: Flame,
  bounceRate: Percent,
  bimi: BadgeCheck,
  complaintRate: MailWarning,
} as const;

/** Category 13 — multi-tenant administration. */
export const admin = {
  tenant: Building,
  domain: Globe,
  domainVerified: CheckCircle2,
  domainPending: AlertCircle,
  users: Users,
  provision: UserPlus,
  suspend: UserMinus,
  roles: UserCog,
  apiKeys: Key,
  sso: Shield,
  aliases: AtSign,
  mailFlow: Workflow,
  quota: HardDrive,
} as const;

/** Category 14 — settings. */
export const settings = {
  general: Settings,
  advanced: Settings2,
  rules: SlidersHorizontal,
  theme: Palette,
  light: Sun,
  dark: Moon,
  system: Monitor,
  splitView: Split,
  densityCompact: Columns,
  densityComfortable: LayoutList,
  densitySpacious: LayoutGrid,
  notifications: Bell,
  doNotDisturb: BellOff,
  shortcuts: Keyboard,
  help: HelpCircle,
  about: Info,
} as const;

/** Category 15 — mobile gestures. */
export const mobile = {
  menu: Menu,
  actionSheet: MoreHorizontal,
  back: ArrowLeft,
  swipeReply: CornerUpLeft,
  swipeArchive: Archive,
  swipeDelete: Trash2,
  swipeSnooze: Clock,
  swipeDone: Check,
  swipeStar: Star,
  pullRefresh: RefreshCw,
  compose: Plus,
} as const;

/** Category 16 — accessibility and status feedback. */
export const status = {
  a11y: Accessibility,
  highContrast: Contrast,
  zoomIn: ZoomIn,
  zoomOut: ZoomOut,
  announcer: Captions,
  success: CheckCircle2,
  warning: AlertCircle,
  error: AlertOctagon,
  info: Info,
  loading: Loader2,
  online: Wifi,
  offline: WifiOff,
} as const;

/** General UI chrome. */
export const chrome = {
  chevronDown: ChevronDown,
  chevronRight: ChevronRight,
  chevronLeft: ChevronLeft,
  chevronUp: ChevronUp,
  collapseSidebar: ChevronsLeft,
  expandSidebar: ChevronsRight,
  close: X,
  confirm: Check,
  add: Plus,
  remove: Minus,
  copy: Copy,
  paste: Clipboard,
  dragVertical: GripVertical,
  dragHorizontal: GripHorizontal,
  reveal: Eye,
  conceal: EyeOff,
  signIn: LogIn,
  signOut: LogOut,
  avatar: CircleUser,
  premium: Crown,
  externalLink: ExternalLink,
  copyLink: Link,
  channel: Hash,
  timestamp: Clock,
  warning: AlertTriangle,
  helpTooltip: CircleHelp,
  fullscreen: Maximize,
} as const;

/**
 * The account center.
 *
 * Split from `settings` because these name places a user GOES (profile,
 * security, devices), while `settings` names things a user CHANGES. The
 * profile menu is navigation, so it reads from here.
 */
export const account = {
  profile: UserCog,
  security: ShieldCheck,
  securityAlert: ShieldAlert,
  devices: Laptop,
  deviceDesktop: Laptop,
  deviceMobile: Smartphone,
  deviceTablet: Tablet,
  deviceUnknown: Globe,
  storage: HardDrive,
  privacy: GlobeLock,
  connectedApps: Plug,
  developer: CodeXml,
  organization: Building,
  revoke: Trash2,
  refresh: RefreshCw,
  manage: ChevronRight,
} as const;

export const icons = {
  mailbox,
  messageState,
  threadAction,
  editor,
  ai,
  search,
  contacts,
  calendar,
  fileType,
  security,
  infra,
  dns,
  admin,
  settings,
  account,
  mobile,
  status,
  chrome,
} as const;

/**
 * Pick an attachment icon from a MIME type.
 *
 * Matched on the type the server reported, never on the filename extension: an
 * attachment called `invoice.pdf` that is really a `.zip` should look like what
 * it is, and an extension is attacker-controlled text.
 */
export function iconForMimeType(mime: string): LucideIcon {
  const type = mime.toLowerCase().split(";")[0]!.trim();
  if (type.startsWith("image/")) return fileType.image;
  if (type.startsWith("video/")) return fileType.video;
  if (type.startsWith("audio/")) return fileType.audio;
  if (type === "application/pdf") return fileType.pdf;

  const byExactType: Record<string, LucideIcon> = {
    "application/zip": fileType.archive,
    "application/x-tar": fileType.archive,
    "application/gzip": fileType.archive,
    "application/x-7z-compressed": fileType.archive,
    "application/vnd.rar": fileType.archive,
    "application/json": fileType.code,
    "application/xml": fileType.code,
    "text/xml": fileType.code,
    "text/html": fileType.code,
    "text/css": fileType.code,
    "text/javascript": fileType.code,
    "application/x-x509-ca-cert": fileType.certificate,
    "application/pkcs8": fileType.certificate,
    "application/vnd.ms-excel": fileType.spreadsheet,
    "text/csv": fileType.spreadsheet,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": fileType.spreadsheet,
    "application/vnd.oasis.opendocument.spreadsheet": fileType.spreadsheet,
    "application/vnd.ms-powerpoint": fileType.presentation,
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": fileType.presentation,
    "application/vnd.oasis.opendocument.presentation": fileType.presentation,
    "text/calendar": calendar.view,
  };
  if (type in byExactType) return byExactType[type]!;

  if (type.startsWith("text/")) return fileType.text;
  if (type.includes("wordprocessing") || type === "application/msword") return fileType.text;
  return fileType.generic;
}
