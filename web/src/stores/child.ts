import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type ChildState = {
  childId: number | null
  setChildId: (id: number | null) => void
}

export const useChildStore = create<ChildState>()(
  persist(
    (set) => ({
      childId: null,
      setChildId: (id) => set({ childId: id }),
    }),
    { name: 'le_child' },
  ),
)
