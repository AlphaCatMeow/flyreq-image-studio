import localforage from "localforage";
import type { StateStorage } from "zustand/middleware";
import { LOCAL_FORAGE } from "@/lib/storage-contract";

const canvasStateStore = localforage.createInstance(LOCAL_FORAGE.canvasState);

export const localForageStorage: StateStorage = {
  getItem: async (name) => {
    if (typeof window === "undefined") return null;
    try {
      return (await canvasStateStore.getItem<string>(name)) || null;
    } catch {
      return window.localStorage.getItem(name);
    }
  },
  setItem: async (name, value) => {
    if (typeof window === "undefined") return;
    try {
      await canvasStateStore.setItem(name, value);
    } catch {
      window.localStorage.setItem(name, value);
    }
  },
  removeItem: async (name) => {
    if (typeof window === "undefined") return;
    try {
      await canvasStateStore.removeItem(name);
    } catch {
      window.localStorage.removeItem(name);
    }
  },
};
