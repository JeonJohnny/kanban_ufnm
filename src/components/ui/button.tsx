import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const variants = cva('inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4', {
  variants: { variant: { default: 'bg-primary text-primary-foreground hover:bg-primary/90', outline: 'border bg-background hover:bg-muted', ghost: 'hover:bg-muted', destructive: 'bg-destructive text-white hover:bg-destructive/90' }, size: { default: 'px-4 py-2', icon: 'size-11', sm: 'px-3 py-2' } },
  defaultVariants: { variant: 'default', size: 'default' },
})
export const Button = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof variants> & { asChild?: boolean }>(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : 'button'
  return <Comp className={cn(variants({ variant, size, className }))} ref={ref} {...props} />
})
Button.displayName = 'Button'
