import { supabase } from '../lib/supabase'
import type { LeaderboardCategory } from '../types'

interface CategoryRow {
  slug: string
  name: string
  icon: string
  display_order: number
  subtitle: string
  accent: string
  picker_label: string
  item_label: string
  empty_message: string
}

/** Active playable categories in their configured display order. */
export async function fetchCategories(): Promise<LeaderboardCategory[]> {
  const { data, error } = await supabase
    .from('categories')
    .select('slug, name, icon, display_order, subtitle, accent, picker_label, item_label, empty_message')
    .eq('is_active', true)
    .order('display_order')
    .order('name')

  if (error) throw new Error(`Ангиллуудыг татаж чадсангүй: ${error.message}`)

  return ((data ?? []) as CategoryRow[]).map((category) => ({
    slug: category.slug,
    name: category.name,
    icon: category.icon,
    displayOrder: category.display_order,
    subtitle: category.subtitle,
    accent: category.accent,
    pickerLabel: category.picker_label,
    itemLabel: category.item_label,
    emptyMessage: category.empty_message,
  }))
}
