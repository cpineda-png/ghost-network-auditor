import { useState } from "react";
import type { RunRequest } from "../types";

type Props = {
  running: boolean;
  onStart: (request: RunRequest) => void;
};

export function RunLauncher({ running, onStart }: Props) {
  const [batch, setBatch] = useState<"A" | "B">("A");
  const [county, setCounty] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [useMemory, setUseMemory] = useState(true);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const scope: RunRequest["scope"] = { batch };
        const countyText = county.trim();
        const specialtyText = specialty.trim();
        if (countyText) scope.county = countyText;
        if (specialtyText) scope.specialty = specialtyText;
        onStart({ scope, useMemory });
      }}
    >
      <fieldset>
        <legend>Batch</legend>
        <label>
          <input
            type="radio"
            name="batch"
            value="A"
            checked={batch === "A"}
            onChange={() => setBatch("A")}
          />
          A
        </label>
        <label>
          <input
            type="radio"
            name="batch"
            value="B"
            checked={batch === "B"}
            onChange={() => setBatch("B")}
          />
          B
        </label>
      </fieldset>
      <label>
        County
        <input value={county} onChange={(event) => setCounty(event.target.value)} />
      </label>
      <label>
        Specialty
        <input value={specialty} onChange={(event) => setSpecialty(event.target.value)} />
      </label>
      <label>
        <input
          type="checkbox"
          checked={useMemory}
          onChange={(event) => setUseMemory(event.target.checked)}
        />
        Use memory
      </label>
      <p className="run-mode" aria-live="polite">
        {useMemory ? "Warm" : "Cold"}
      </p>
      <button type="submit" disabled={running}>
        Start
      </button>
    </form>
  );
}
