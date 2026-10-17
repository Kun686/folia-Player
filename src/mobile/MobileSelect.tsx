import type { ComponentProps } from 'react';
import { ChevronDown } from 'lucide-react';

// MobileSelect.tsx — keep the system option picker with a consistent, touch-sized closed control.
export default function MobileSelect(props: ComponentProps<'select'>) {
  return <span className="mobile-select"><select {...props} /><ChevronDown size={18} aria-hidden="true" /></span>;
}
