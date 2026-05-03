import { SetupState } from "../types";

export interface StepProps {
  state: SetupState;
  patch: (delta: Partial<SetupState>) => Promise<SetupState>;
  onContinue: () => void | Promise<void>;
  onBack?: () => void | Promise<void>;
}
