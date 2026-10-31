/**
 * 客户端自绘视觉资产：导航图标、小狐狸吉祥物、装饰元素。
 * 全部手写 SVG，不引第三方插画包：方便随时改线宽和配色，也不受外部素材版权限制。
 * 深色模式下客户端不会切换（一直是暖光纸），所以这里的暖色常量用固定 hex；
 * 描边统一走 currentColor，这样图标颜色可以跟着选中态变。
 */

type ArtProps = {
  className?: string
  /** 关掉后所有装饰动效停摆，用于 prefers-reduced-motion 或家长手动关闭 */
  motion?: boolean
}

const FUR = '#E8873C'
const FUR_DEEP = '#D1701F'
const CREAM = '#FFF6E9'
const BLUSH = '#F4AF9C'
const INK = '#5A3A26'

const strokeProps = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

/* ---------------------------------- 导航图标 --------------------------------- */

export function IconToday({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <rect x="3.2" y="5.4" width="17.6" height="15.4" rx="4.4" fill="hsl(var(--persimmon-soft))" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8.2 3.2v4.2M15.8 3.2v4.2" {...strokeProps} />
      <path d="M3.2 10.6h17.6" {...strokeProps} />
      <path d="M8.6 15.4l2.2 2.2 4.6-4.8" {...strokeProps} strokeWidth={1.9} />
    </svg>
  )
}

export function IconChinese({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        d="M12 7.4C10.2 5.7 7.3 5.2 4.2 5.6v11.4c3.1-.4 6 0 7.8 1.7 1.8-1.7 4.7-2.1 7.8-1.7V5.6c-3.1-.4-6 0-7.8 1.7z"
        fill="hsl(var(--persimmon-soft))"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M12 7.4v11.3" {...strokeProps} />
      <path d="M6.4 9.8h3.3M6.4 12.8h3.3M14.3 9.8h3.3M14.3 12.8h3.3" {...strokeProps} strokeWidth="1.5" opacity="0.6" />
    </svg>
  )
}

export function IconMath({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <rect x="3.2" y="4.6" width="17.6" height="14.8" rx="3.8" fill="hsl(var(--persimmon-soft))" stroke="currentColor" strokeWidth="1.7" />
      <path d="M3.2 12h17.6" {...strokeProps} strokeWidth="1.5" opacity="0.45" />
      <path d="M7.7 6.2v11.6M12 6.2v11.6M16.3 6.2v11.6" {...strokeProps} strokeWidth="1.5" opacity="0.6" />
      <circle cx="7.7" cy="9.2" r="1.95" fill="currentColor" opacity="0.85" />
      <circle cx="12" cy="9.2" r="1.95" fill="currentColor" opacity="0.85" />
      <circle cx="16.3" cy="14.9" r="1.95" fill="currentColor" opacity="0.85" />
      <circle cx="12" cy="14.9" r="1.95" fill="currentColor" opacity="0.85" />
    </svg>
  )
}

export function IconEnglish({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        d="M20.4 5.2H3.6A1.7 1.7 0 0 0 1.9 6.9v6.4a1.7 1.7 0 0 0 1.7 1.7h2.7v3.6l4.3-3.6h9.8a1.7 1.7 0 0 0 1.7-1.7V6.9a1.7 1.7 0 0 0-1.7-1.7z"
        fill="hsl(var(--persimmon-soft))"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M9.3 13.6 12 8.1l2.7 5.5" {...strokeProps} strokeWidth={1.75} />
      <path d="M10.4 11.7h3.2" {...strokeProps} strokeWidth={1.75} />
    </svg>
  )
}

export function IconMe({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M8.6 15.1 6.5 21l3.4-1.7M15.4 15.1 17.5 21l-3.4-1.7" {...strokeProps} />
      <circle cx="12" cy="9.4" r="6.3" fill="hsl(var(--persimmon-soft))" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M12 5.4l1.2 2.4 2.7.4-1.95 1.9.46 2.7L12 11.6l-2.41 1.2.46-2.7-1.95-1.9 2.7-.4L12 5.4z"
        fill="currentColor"
        opacity="0.55"
      />
    </svg>
  )
}

/* --------------------------------- 小狐狸吉祥物 -------------------------------- */

function FoxFace({ sleeping = false }: { sleeping?: boolean }) {
  return (
    <>
      <path d="M47 40C43 23 47 15 57 17c10 2 16 12 14 23z" fill={FUR} />
      <path d="M51 39c-2-11 1-16 7-15 5 1 8 7 7 14z" fill={BLUSH} opacity="0.85" />
      <path d="M113 40c4-17 0-25-10-23-10 2-16 12-14 23z" fill={FUR} />
      <path d="M109 39c2-11-1-16-7-15-5 1-8 7-7 14z" fill={BLUSH} opacity="0.85" />
      <path
        d="M80 22c24 0 40 14 40 34 0 8-2 14-6 19 6 5 8 11 2 17-6 6-20 8-36 8s-30-2-36-8c-6-6-4-12 2-17-4-5-6-11-6-19 0-20 16-34 40-34z"
        fill={FUR}
      />
      <ellipse cx="80" cy="70" rx="31" ry="25" fill={CREAM} />
      <ellipse cx="80" cy="79" rx="9" ry="7" fill={CREAM} />
      <ellipse cx="80" cy="77" rx="5.6" ry="4.4" fill={INK} />
      {sleeping ? (
        <>
          <path d="M60 62q6 6 12 0" stroke={INK} strokeWidth="2.6" strokeLinecap="round" fill="none" />
          <path d="M88 62q6 6 12 0" stroke={INK} strokeWidth="2.6" strokeLinecap="round" fill="none" />
        </>
      ) : (
        <>
          <circle cx="66" cy="61" r="4.8" fill={INK} />
          <circle cx="94" cy="61" r="4.8" fill={INK} />
          <circle cx="67.8" cy="59" r="1.7" fill="#FFFFFF" />
          <circle cx="95.8" cy="59" r="1.7" fill="#FFFFFF" />
        </>
      )}
      <circle cx="55" cy="76" r="5.4" fill={BLUSH} opacity="0.75" />
      <circle cx="105" cy="76" r="5.4" fill={BLUSH} opacity="0.75" />
      <path d="M80 82v3M80 85q-4.6 4.6-8.6 1M80 85q4.6 4.6 8.6 1" stroke={INK} strokeWidth="2.1" strokeLinecap="round" fill="none" />
    </>
  )
}

function FoxBody() {
  return (
    <>
      <rect x="44" y="98" width="72" height="50" rx="25" fill={FUR} />
      <rect x="58" y="114" width="44" height="34" rx="17" fill={CREAM} />
      <ellipse cx="58" cy="145" rx="15" ry="8.6" fill={CREAM} />
      <ellipse cx="102" cy="145" rx="15" ry="8.6" fill={CREAM} />
    </>
  )
}

/** 挥手打招呼：默认状态，用在首页和空状态引导 */
export function FoxWave({ className, motion = true }: ArtProps) {
  return (
    <svg viewBox="0 0 160 160" className={className} role="img" aria-label="挥手的小狐狸">
      <g className={motion ? 'animate-wiggle' : undefined} style={{ transformOrigin: '104px 132px' }}>
        <path d="M104 136c32 2 48-20 38-40-4-8-12-12-16-8" stroke={FUR} strokeWidth="26" strokeLinecap="round" fill="none" />
        <circle cx="126" cy="88" r="12.5" fill={CREAM} />
      </g>
      <FoxBody />
      <g className={motion ? 'animate-bounce-gentle' : undefined} style={{ transformOrigin: '108px 116px' }}>
        <path d="M108 114c10-4 14-14 10-22" stroke={FUR} strokeWidth="12" strokeLinecap="round" fill="none" />
        <circle cx="117" cy="90" r="7.2" fill={CREAM} />
      </g>
      <path d="M52 116c-6 6-6 16 2 20" stroke={FUR} strokeWidth="12" strokeLinecap="round" fill="none" />
      <circle cx="55" cy="137" r="6.6" fill={CREAM} />
      <FoxFace />
    </svg>
  )
}

/** 举星欢呼：成绩优秀和连续打卡达标时用 */
export function FoxCheer({ className, motion = true }: ArtProps) {
  return (
    <svg viewBox="0 0 160 160" className={className} role="img" aria-label="欢呼的小狐狸">
      <g className={motion ? 'animate-wiggle' : undefined} style={{ transformOrigin: '104px 132px' }}>
        <path d="M104 136c32 2 48-20 38-40-4-8-12-12-16-8" stroke={FUR} strokeWidth="26" strokeLinecap="round" fill="none" />
        <circle cx="126" cy="88" r="12.5" fill={CREAM} />
      </g>
      <FoxBody />
      <path d="M50 116c-8-4-10-14-6-20" stroke={FUR} strokeWidth="12" strokeLinecap="round" fill="none" />
      <circle cx="43" cy="94" r="7.2" fill={CREAM} />
      <path d="M110 116c8-4 10-14 6-20" stroke={FUR} strokeWidth="12" strokeLinecap="round" fill="none" />
      <circle cx="117" cy="94" r="7.2" fill={CREAM} />
      <FoxFace />
      <g className={motion ? 'animate-bounce-in' : undefined}>
        <path
          d="M80 6l3.6 8.2L92 17l-8.4 6.6L86.4 33 80 27.8 73.6 33l3.2-9.4L68.4 17l8.4-2.8L80 6z"
          fill={CREAM}
          stroke={FUR_DEEP}
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </g>
      {motion && (
        <>
          <circle cx="30" cy="34" r="3.4" fill={FUR_DEEP} className="animate-bounce-in [animation-delay:120ms]" opacity="0.55" />
          <circle cx="132" cy="26" r="2.6" fill={FUR_DEEP} className="animate-bounce-in [animation-delay:220ms]" opacity="0.5" />
          <circle cx="142" cy="62" r="3.2" fill={FUR_DEEP} className="animate-bounce-in [animation-delay:80ms]" opacity="0.45" />
        </>
      )}
    </svg>
  )
}

/** 打盹：还没有任务、题库没配好的空状态 */
export function FoxSleep({ className, motion = true }: ArtProps) {
  return (
    <svg viewBox="0 0 160 160" className={className} role="img" aria-label="打盹的小狐狸">
      <g className={motion ? 'animate-float' : undefined}>
        <path d="M104 136c32 2 48-20 38-40-4-8-12-12-16-8" stroke={FUR} strokeWidth="26" strokeLinecap="round" fill="none" />
        <circle cx="126" cy="88" r="12.5" fill={CREAM} />
      </g>
      <FoxBody />
      <path d="M52 118c-6 4-8 12-2 17" stroke={FUR} strokeWidth="12" strokeLinecap="round" fill="none" />
      <circle cx="50" cy="138" r="6.6" fill={CREAM} />
      <path d="M108 118c6 4 8 12 2 17" stroke={FUR} strokeWidth="12" strokeLinecap="round" fill="none" />
      <circle cx="110" cy="138" r="6.6" fill={CREAM} />
      <FoxFace sleeping />
      <g fill="none" stroke={INK} strokeWidth="2.4" strokeLinecap="round" opacity="0.6">
        <path d="M118 26h9l-9 10h9" className={motion ? 'animate-float' : undefined} />
        <path d="M136 8h6l-6 7h6" className={motion ? 'animate-float [animation-delay:300ms]' : undefined} opacity="0.7" />
      </g>
    </svg>
  )
}

/* ----------------------------------- 成就物件 ---------------------------------- */

const GOLD = '#F0B13B'
const GOLD_DEEP = '#CE8A1C'
const GOLD_LIGHT = '#FFE2A8'

/** 奖杯：今日三科全部完成、打卡成功时用，替代原来的小狐狸欢呼 */
export function TrophyArt({ className, motion = true }: ArtProps) {
  return (
    <svg viewBox="0 0 160 160" className={className} role="img" aria-label="打卡成功奖杯">
      <ellipse cx="80" cy="148" rx="42" ry="6" fill={INK} opacity="0.08" />
      {/* 把手 */}
      <path d="M44 46c-16 2-22 18-14 30 5 7 12 8 15 5" fill="none" stroke={GOLD_DEEP} strokeWidth="8" strokeLinecap="round" />
      <path d="M116 46c16 2 22 18 14 30-5 7-12 8-15 5" fill="none" stroke={GOLD_DEEP} strokeWidth="8" strokeLinecap="round" />
      {/* 底座 */}
      <rect x="60" y="104" width="40" height="14" rx="5" fill={GOLD_DEEP} />
      <rect x="46" y="116" width="68" height="13" rx="6.5" fill={GOLD_DEEP} />
      <rect x="52" y="127" width="56" height="12" rx="6" fill={GOLD} />
      {/* 杯身 */}
      <path
        d="M44 28h72v34c0 24-18 36-28 42h-16c-10-6-28-18-28-42z"
        fill={GOLD}
        stroke={GOLD_DEEP}
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <path d="M52 36c0 22 12 34 22 40h-6c-10-6-28-18-28-42z" fill={GOLD_LIGHT} opacity="0.75" />
      {/* 杯口的星 */}
      <g className={motion ? 'animate-bounce-gentle' : undefined} style={{ transformOrigin: '80px 60px' }}>
        <path
          d="M80 44l3.4 7.8 8.1 3-8.1 3-3.4 7.8-3.4-7.8-8.1-3 8.1-3z"
          fill={CREAM}
          stroke={GOLD_DEEP}
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </g>
      {/* 旁边闪的小星 */}
      {motion && (
        <>
          <path d="M26 34l2 4.6 4.8 1.8-4.8 1.8-2 4.6-2-4.6L19.2 40.4 24 38.6z" fill={GOLD_LIGHT} className="animate-bounce-in [animation-delay:120ms]" />
          <path d="M134 24l1.6 3.6 3.8 1.4-3.8 1.4-1.6 3.6-1.6-3.6-3.8-1.4 3.8-1.4z" fill={GOLD_LIGHT} className="animate-bounce-in [animation-delay:260ms]" />
          <path d="M142 78l1.4 3.2 3.4 1.2-3.4 1.2-1.4 3.2-1.4-3.2-3.4-1.2 3.4-1.2z" fill={GOLD_LIGHT} className="animate-bounce-in [animation-delay:60ms]" />
        </>
      )}
    </svg>
  )
}

/* ---------------------------------- 装饰元素 ---------------------------------- */

export function WavyLine({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 8" preserveAspectRatio="none" className={className} aria-hidden="true">
      <path d="M0 4 Q10 0 20 4 T40 4 T60 4 T80 4 T100 4 T120 4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  )
}

export function Sparkle({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M12 2.5l2.3 6.4 6.4 2.3-6.4 2.3-2.3 6.4-2.3-6.4L3.3 11.2l6.4-2.3L12 2.5z" fill="currentColor" />
    </svg>
  )
}

/** 科目方块：给科目卡做身份标识，图标取色跟着科目的 CSS 变量走 */
export function SubjectTile({ subject, className }: { subject: 'chinese' | 'math' | 'english'; className?: string }) {
  const Glyph = subject === 'chinese' ? IconChinese : subject === 'math' ? IconMath : IconEnglish
  return <Glyph className={className} />
}
