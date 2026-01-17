"use client"

import type React from "react"
import { useRef } from "react"

interface MagneticButtonProps {
  children: React.ReactNode
  className?: string
  variant?: "primary" | "secondary" | "ghost"
  size?: "default" | "lg"
  onClick?: () => void
  type?: "button" | "submit" | "reset"
  disabled?: boolean
}

export function MagneticButton({
  children,
  className = "",
  variant = "primary",
  size = "default",
  onClick,
  type = "button",
  disabled = false,
}: MagneticButtonProps) {
  const ref = useRef<HTMLButtonElement>(null)

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`
        relative overflow-hidden rounded-full font-medium
        transition-all duration-300 ease-out
        ${variants[variant]}
        ${sizes[size]}
        ${className}
        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
      `}
    >
      <span className="relative z-10">{children}</span>
    </button>
  )
}
