function FilterSelect({
  label,
  value,
  onChange,
  options,
}) {
  const getLabel = (option) => {
    if (option === "All") {
      return `All ${label}s`;
    }

    if (option === "ym") {
      return "Year / Month";
    }

    if (option === "day") {
      return "Specific Date";
    }

    if (option === "range") {
      return "Custom Range";
    }

    return option;
  };

  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      <span className="dashboard-eyebrow">
        {label}
      </span>

      <select
        value={value}
        onChange={(event) =>
          onChange(event.target.value)
        }
        style={{
          padding: "8px 10px",
          borderRadius: 10,
          border:
            "1px solid var(--dashboard-border)",
          background:
            "var(--dashboard-card)",
          color:
            "var(--dashboard-abyssal)",
          fontSize: 12,
        }}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {getLabel(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

function DateFilterBar({
  value,
  onChange,
  years,
  months,
}) {
  const update = (changes) => {
    onChange({
      ...value,
      ...changes,
    });
  };

  const inputStyle = {
    padding: "8px 10px",
    borderRadius: 10,
    border:
      "1px solid var(--dashboard-border)",
    background:
      "var(--dashboard-card)",
    color:
      "var(--dashboard-abyssal)",
    fontSize: 12,
  };

  const changeMode = (mode) => {
    onChange({
      mode,
      year: value.year ?? "All",
      month: value.month ?? "All",
      date: value.date ?? "",
      startDate: value.startDate ?? "",
      endDate: value.endDate ?? "",
    });
  };

  return (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 12,
      flexWrap: "wrap",
      padding: 14,
      marginBottom: 18,
      border:
        "1px solid var(--dashboard-border)",
      borderRadius: 14,
      background:
        "var(--dashboard-panel-alt)",
    }}
  >
    <FilterSelect
      label="Mode"
      value={value.mode}
      onChange={changeMode}
      options={[
        "ym",
        "day",
        "range",
      ]}
    />

    {value.mode === "ym" && (
      <>
        <FilterSelect
          label="Year"
          value={value.year}
          onChange={(year) =>
            update({ year })
          }
          options={years}
        />

        <FilterSelect
          label="Month"
          value={value.month}
          onChange={(month) =>
            update({ month })
          }
          options={months}
        />
      </>
    )}

    {value.mode === "day" && (
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span className="dashboard-eyebrow">
          Date
        </span>

        <input
          type="date"
          value={value.date}
          onChange={(event) =>
            update({
              date: event.target.value,
            })
          }
          style={inputStyle}
        />
      </label>
    )}

    {value.mode === "range" && (
      <>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span className="dashboard-eyebrow">
            Start
          </span>

          <input
            type="date"
            value={value.startDate}
            max={
              value.endDate ||
              undefined
            }
            onChange={(event) =>
              update({
                startDate:
                  event.target.value,
              })
            }
            style={inputStyle}
          />
        </label>

        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span className="dashboard-eyebrow">
            End
          </span>

          <input
            type="date"
            value={value.endDate}
            min={
              value.startDate ||
              undefined
            }
            onChange={(event) =>
              update({
                endDate:
                  event.target.value,
              })
            }
            style={inputStyle}
          />
        </label>
      </>
    )}

    <button
      type="button"
      onClick={() =>
        onChange({
          mode: "ym",
          year: "All",
          month: "All",
          date: "",
          startDate: "",
          endDate: "",
        })
      }
      style={{
        padding: "8px 12px",
        borderRadius: 10,
        border:
          "1px solid var(--dashboard-border)",
        background:
          "var(--dashboard-card)",
        color:
          "var(--dashboard-truffle)",
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      Clear
    </button>
  </div>
);
}
export default DateFilterBar;
