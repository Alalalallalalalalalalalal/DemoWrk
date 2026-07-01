import { useEffect, useState } from "react";

const C = {
  border: "var(--dashboard-border)",
  card: "var(--dashboard-card)",
  panelAlt: "var(--dashboard-panel-alt)",
  text: "var(--dashboard-abyssal)",
  truffle: "var(--dashboard-truffle)",
  flame: "var(--dashboard-flame)",
};

export const YEARS_SHOWN_OPTIONS = [
  "Past 5 years",
  "Past 10 years",
  "Past 15 years",
  "Past 20 years",
  "All years",
];

export const MONTH_OPTIONS = [
  { value: 1, label: "Jan" },
  { value: 2, label: "Feb" },
  { value: 3, label: "Mar" },
  { value: 4, label: "Apr" },
  { value: 5, label: "May" },
  { value: 6, label: "Jun" },
  { value: 7, label: "Jul" },
  { value: 8, label: "Aug" },
  { value: 9, label: "Sep" },
  { value: 10, label: "Oct" },
  { value: 11, label: "Nov" },
  { value: 12, label: "Dec" },
];

export const MAX_CUSTOM_RANGE_MONTHS = 24;

export const DEFAULT_VISITOR_FILTER = {
  mode: "year",
  yearsShown: "Past 10 years",
  endingYear: "Latest year",
  startMonth: "",
  startYear: "",
  endMonth: "",
  endYear: "",
};

const selectStyle = {
  padding: "8px 10px",
  borderRadius: 10,
  border: `1px solid ${C.border}`,
  background: C.card,
  color: C.text,
  fontSize: 12,
};

const clearButtonStyle = {
  padding: "8px 12px",
  borderRadius: 10,
  border: `1px solid ${C.border}`,
  background: C.card,
  color: C.truffle,
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};

function Field({ label, children }) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      <span className="dashboard-eyebrow">{label}</span>
      {children}
    </label>
  );
}

const monthsBetween = (sy, sm, ey, em) =>
  (Number(ey) - Number(sy)) * 12 + (Number(em) - Number(sm)) + 1;

export default function NewVsRepeatFilterBar({
  value = DEFAULT_VISITOR_FILTER,
  onChange = () => {},
  yearsAvailable = [],
  currentYear = new Date().getFullYear(),
}) {
  const [draftStartMonth, setDraftStartMonth] = useState(
    value.startMonth || "",
  );
  const [draftStartYear, setDraftStartYear] = useState(
    value.startYear || "",
  );
  const [draftEndMonth, setDraftEndMonth] = useState(value.endMonth || "");
  const [draftEndYear, setDraftEndYear] = useState(value.endYear || "");
  const [validationError, setValidationError] = useState("");

  useEffect(() => {
    setDraftStartMonth(value.startMonth || "");
    setDraftStartYear(value.startYear || "");
    setDraftEndMonth(value.endMonth || "");
    setDraftEndYear(value.endYear || "");
    setValidationError("");
  }, [
    value.startMonth,
    value.startYear,
    value.endMonth,
    value.endYear,
    value.mode,
  ]);

  const sortedYears = [...yearsAvailable].sort((a, b) => a - b);

  const endingYearOptions = [
    "Latest year",
    ...yearsAvailable.filter((year) => year !== currentYear),
  ];

  const changeMode = (mode) => {
    if (mode === "year") {
      onChange({
        ...DEFAULT_VISITOR_FILTER,
        mode: "year",
        yearsShown: value.yearsShown || DEFAULT_VISITOR_FILTER.yearsShown,
        endingYear: value.endingYear || DEFAULT_VISITOR_FILTER.endingYear,
      });
    } else {
      setValidationError("");
      onChange({
        ...value,
        mode: "range",
      });
    }
  };

  const applyRange = () => {
    if (
      !draftStartMonth ||
      !draftStartYear ||
      !draftEndMonth ||
      !draftEndYear
    ) {
      setValidationError(
        "Select a start month/year and an end month/year.",
      );
      return;
    }

    const span = monthsBetween(
      draftStartYear,
      draftStartMonth,
      draftEndYear,
      draftEndMonth,
    );

    if (span <= 0) {
      setValidationError(
        "End month must be on or after the start month.",
      );
      return;
    }

    if (span > MAX_CUSTOM_RANGE_MONTHS) {
      setValidationError(
        `Custom ranges can span at most ${MAX_CUSTOM_RANGE_MONTHS} months.`,
      );
      return;
    }

    setValidationError("");

    onChange({
      ...value,
      mode: "range",
      startMonth: draftStartMonth,
      startYear: draftStartYear,
      endMonth: draftEndMonth,
      endYear: draftEndYear,
    });
  };

  const clearAll = () => {
    setDraftStartMonth("");
    setDraftStartYear("");
    setDraftEndMonth("");
    setDraftEndYear("");
    setValidationError("");
    onChange({ ...DEFAULT_VISITOR_FILTER });
  };

  return (
    <div style={{ marginBottom: 18 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          padding: 14,
          border: `1px solid ${C.border}`,
          borderRadius: 14,
          background: C.panelAlt,
        }}
      >
        <Field label="Mode">
          <select
            value={value.mode}
            onChange={(event) => changeMode(event.target.value)}
            style={selectStyle}
          >
            <option value="year">Year</option>
            <option value="range">Custom Range</option>
          </select>
        </Field>

        {value.mode === "year" && (
          <>
            <Field label="Years shown">
              <select
                value={value.yearsShown}
                onChange={(event) =>
                  onChange({
                    ...value,
                    mode: "year",
                    yearsShown: event.target.value,
                  })
                }
                style={selectStyle}
              >
                {YEARS_SHOWN_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </Field>

            {value.yearsShown !== "All years" && (
              <Field label="Ending year">
                <select
                  value={value.endingYear}
                  onChange={(event) =>
                    onChange({
                      ...value,
                      mode: "year",
                      endingYear: event.target.value,
                    })
                  }
                  style={selectStyle}
                >
                  {endingYearOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </>
        )}

        {value.mode === "range" && (
          <>
            <Field label="Start">
              <select
                value={draftStartMonth}
                onChange={(event) =>
                  setDraftStartMonth(event.target.value)
                }
                style={selectStyle}
              >
                <option value="">Month</option>
                {MONTH_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>

              <select
                value={draftStartYear}
                onChange={(event) =>
                  setDraftStartYear(event.target.value)
                }
                style={selectStyle}
              >
                <option value="">Year</option>
                {sortedYears.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="End">
              <select
                value={draftEndMonth}
                onChange={(event) =>
                  setDraftEndMonth(event.target.value)
                }
                style={selectStyle}
              >
                <option value="">Month</option>
                {MONTH_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>

              <select
                value={draftEndYear}
                onChange={(event) =>
                  setDraftEndYear(event.target.value)
                }
                style={selectStyle}
              >
                <option value="">Year</option>
                {sortedYears.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </Field>

            <button
              type="button"
              onClick={applyRange}
              style={{
                ...clearButtonStyle,
                color: C.text,
              }}
            >
              Apply
            </button>
          </>
        )}

        <button type="button" onClick={clearAll} style={clearButtonStyle}>
          Clear
        </button>
      </div>

      {value.mode === "range" && validationError && (
        <div
          role="alert"
          style={{
            marginTop: 8,
            fontSize: 11,
            color: C.flame,
            fontWeight: 600,
          }}
        >
          {validationError}
        </div>
      )}

      {value.mode === "range" && !validationError && (
        <div
          style={{
            marginTop: 8,
            fontSize: 11,
            color: "var(--dashboard-muted)",
          }}
        >
          Custom ranges can span up to {MAX_CUSTOM_RANGE_MONTHS} months and
          may cross a calendar year (e.g. Dec 2021 – Mar 2022).
        </div>
      )}
    </div>
  );
}