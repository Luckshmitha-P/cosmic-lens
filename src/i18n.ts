import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import ta from './locales/ta.json'
import en from './locales/en.json'
import ml from './locales/ml.json'
import te from './locales/te.json'
import hi from './locales/hi.json'

export const languageOptions = [
  { code: 'en', label: 'English' },
  { code: 'ta', label: 'தமிழ்' },
  { code: 'ml', label: 'മലയാളം' },
  { code: 'te', label: 'తెలుగు' },
  { code: 'hi', label: 'हिन्दी' },
] as const

let storedLanguage: string | null = null
try {
  storedLanguage = localStorage.getItem('cosmic-lens-language')
} catch {
  // English remains the default when browser storage is unavailable.
}
const initialLanguage = languageOptions.some(({ code }) => code === storedLanguage) ? storedLanguage! : 'en'

void i18n.use(initReactI18next).init({
  resources: { ta: { translation: ta }, en: { translation: en }, ml: { translation: ml }, te: { translation: te }, hi: { translation: hi } },
  lng: initialLanguage,
  fallbackLng: 'en',
  supportedLngs: languageOptions.map(({ code }) => code),
  interpolation: { escapeValue: false },
  returnNull: false,
})

i18n.on('languageChanged', (language) => {
  const supported = languageOptions.some(({ code }) => code === language)
  if (!supported) return
  try {
    localStorage.setItem('cosmic-lens-language', language)
  } catch {
    // Language switching remains available when browser storage is disabled.
  }
  document.documentElement.lang = language
})

document.documentElement.lang = initialLanguage

export default i18n
