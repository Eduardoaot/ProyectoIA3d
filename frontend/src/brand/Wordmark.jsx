import { motion } from 'motion/react'

export default function Wordmark({ size = '2rem', animate = true, delay = 0, className = '' }) {
    const letters = ['c', 'a', 'U', 'c', 'e']
    return (
        <span className={`wordmark ${className}`} style={{ fontSize: size }} aria-label="cauce">
            {letters.map((l, i) =>
                l === 'U' ? (
                    <svg key={i} viewBox="0 0 20 20" aria-hidden="true">
                        <motion.path
                        d="M3.2 0 V10 C3.2 15.5 6.6 18.6 10 18.6 C13.4 18.6 16.8 15.5 16.8 10 V0"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="4.2"
                        strokeLinecap="butt"
                        initial={animate ? { pathLength: 0 } : false}
                        animate={{ pathLength: 1 }}
                        transition={{ duration: 0.9, delay: delay + 0.25, ease: [0.83, 0, 0.17, 1] }}
                        />
                    </svg>
                    ) : (
                    <motion.span
                        key={i}
                        aria-hidden="true"
                        style={{ display: 'inline-block' }}
                        initial={animate ? { y: '0.6em', opacity: 0 } : false}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ duration: 0.7, delay: delay + i * 0.06, ease: [0.16, 1, 0.3, 1] }}
                    >
                        {l}
                    </motion.span>
                ),
            )}
        </span>
    )
}