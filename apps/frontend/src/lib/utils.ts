import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** shadcn class-merge util: feltételes osztályok + Tailwind-konfliktus feloldás. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
