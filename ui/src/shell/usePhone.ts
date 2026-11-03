import { useEffect, useState } from "react";

export function usePhone(): boolean {
  const [phone, setPhone] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 560px)").matches);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 560px)");
    const change = (event: MediaQueryListEvent) => setPhone(event.matches);
    media.addEventListener("change", change);
    setPhone(media.matches);
    return () => media.removeEventListener("change", change);
  }, []);
  return phone;
}
