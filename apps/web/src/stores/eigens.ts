import { create } from 'zustand';
import type { EigenStatus } from '@eigenswarm/shared';

// Thin optimistic status layer — real data comes from React Query hooks
interface EigenStore {
  optimisticStatuses: Record<string, EigenStatus>;
  setOptimisticStatus: (id: string, status: EigenStatus) => void;
  clearOptimisticStatus: (id: string) => void;
}

export const useEigenStore = create<EigenStore>((set) => ({
  optimisticStatuses: {},
  setOptimisticStatus: (id, status) =>
    set((state) => ({
      optimisticStatuses: { ...state.optimisticStatuses, [id]: status },
    })),
  clearOptimisticStatus: (id) =>
    set((state) => {
      const { [id]: _, ...rest } = state.optimisticStatuses;
      return { optimisticStatuses: rest };
    }),
}));
