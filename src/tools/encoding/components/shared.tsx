import type { ReactNode } from 'react';
import { ArrowDownUp } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Segmented } from '@/components/ui/Segmented';
import { Opt } from '../../text/components/shared';

export type Direction = 'encode' | 'decode';

/** Encode/Decode selector plus a button that feeds the output back in as input. */
export function DirectionControls({
  direction,
  onDirection,
  onSwap,
  canSwap,
  labels = { encode: 'Encode', decode: 'Decode' },
}: {
  direction: Direction;
  onDirection: (d: Direction) => void;
  onSwap: () => void;
  canSwap: boolean;
  labels?: { encode: ReactNode; decode: ReactNode };
}) {
  return (
    <>
      <Opt label="Mode">
        <Segmented
          label="Mode"
          value={direction}
          onChange={onDirection}
          options={[
            { value: 'encode', label: labels.encode },
            { value: 'decode', label: labels.decode },
          ]}
        />
      </Opt>
      <Button
        icon={ArrowDownUp}
        onClick={onSwap}
        disabled={!canSwap}
        title="Use the output as the new input and switch direction"
        className="mb-px self-end"
      >
        Swap
      </Button>
    </>
  );
}
