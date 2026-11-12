// A short message in the corner for 4.2 s (copy done, or an error while a case is open).
import { useCallback, useEffect, useRef, useState } from "react";

export interface ToastState { message: string; show: boolean }

export function useToast() {
  const [toastState, setState] = useState<ToastState>({ message: "", show: false });
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const toast = useCallback((message: string) => {
    setState({ message, show: true });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState((s) => ({ ...s, show: false })), 4200);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return { toast, toastState };
}

export function Toast({ state }: { state: ToastState }) {
  return <div className={`toast${state.show ? " show" : ""}`} id="toast" role="status" aria-live="polite">{state.message}</div>;
}
