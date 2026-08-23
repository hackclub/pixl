import 'server-only'

const dictionaries = {
  en: () => import('./dictionaries/en.json').then((m) => m.default),
  fr: () => import('./dictionaries/fr.json').then((m) => m.default),
  es: () => import('./dictionaries/es.json').then((m) => m.default),
  pt: () => import('./dictionaries/pt.json').then((m) => m.default),
  hi: () => import('./dictionaries/hi.json').then((m) => m.default),
}

export type Locale = keyof typeof dictionaries

export const locales = Object.keys(dictionaries) as Locale[]

export const defaultLocale: Locale = 'en'

export const hasLocale = (locale: string): locale is Locale =>
  locale in dictionaries

export const getDictionary = async (locale: Locale) => dictionaries[locale]()
