/* Deterministic answers over the selected, validated static snapshot. */
(function (root) {
  "use strict";

  var MAX_QUESTION_LENGTH = 1000;

  function fail(message) {
    throw new TypeError(message);
  }

  function result(data, status, answer, filters, source) {
    return {
      status: status,
      answer: answer + " | source: " + source + " | snapshot: " + data.snapshot_id,
      resolved_filters: {
        intent: filters.intent,
        metric: filters.metric,
        countries: filters.countries.slice(),
        year: filters.year,
        start_year: filters.start_year,
        end_year: filters.end_year
      },
      snapshot_id: data.snapshot_id,
      metric: filters.metric,
      countries: filters.countries.slice(),
      year: filters.year,
      start_year: filters.start_year,
      end_year: filters.end_year,
      source: source
    };
  }

  function uniqueMatches(text, candidates) {
    var matches = [];
    candidates.forEach(function (candidate) {
      if (!candidate.phrase) return;
      var phrase = String(candidate.phrase).trim().toLowerCase();
      if (!phrase) return;
      var escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
      var pattern = new RegExp("(^|[^a-z0-9])(" + escaped + ")(?=$|[^a-z0-9])", "g");
      var match;
      while ((match = pattern.exec(text)) !== null) {
        var start = match.index + match[1].length;
        matches.push({ start: start, end: start + match[2].length, id: candidate.id });
        if (match[0].length === 0) pattern.lastIndex += 1;
      }
    });
    return Array.from(new Set(matches.filter(function (match) {
      return !matches.some(function (other) {
        return (other.end - other.start) > (match.end - match.start) &&
          other.start <= match.start && other.end >= match.end;
      });
    }).map(function (match) { return match.id; })));
  }

  function numberYear(value, name, lower, upper) {
    if (typeof value !== "number" || !Number.isInteger(value) || value < lower || value > upper) {
      fail(name + " must be an integer within the selected snapshot window");
    }
    return value;
  }

  function resolveSource(data, metric) {
    var item = (Array.isArray(data.metrics) ? data.metrics : []).find(function (candidate) { return candidate.id === metric; });
    return (item && item.source_url) || data.source || "Source unavailable";
  }

  function answer(data, payload) {
    if (!data || typeof data !== "object" || !payload || typeof payload !== "object" || Array.isArray(payload)) {
      fail("request must be a JSON object");
    }
    if (typeof payload.question !== "string" || !payload.question.trim() || payload.question.length > MAX_QUESTION_LENGTH) {
      fail("question must be a nonempty string of at most 1000 characters");
    }
    if (payload.snapshot_id !== data.snapshot_id) fail("Question snapshot does not match the selected data snapshot");

    var metrics = Array.isArray(data.metrics) ? data.metrics.filter(function (item) {
      return item && typeof item.id === "string";
    }) : [];
    var countries = Array.isArray(data.countries) ? data.countries.filter(function (item) {
      return item && typeof item.id === "string" && typeof item.name === "string";
    }) : [];
    var metricById = Object.create(null);
    var countryById = Object.create(null);
    metrics.forEach(function (item) { metricById[item.id] = item; });
    countries.forEach(function (item) { countryById[item.id] = item; });
    var window = data.window;
    if (!window || typeof window.start !== "number" || !Number.isInteger(window.start) ||
        typeof window.end !== "number" || !Number.isInteger(window.end) || window.start > window.end) {
      fail("Selected snapshot has an invalid year window");
    }
    var lower = window.start;
    var upper = window.end;

    var metric = payload.metric;
    if (metric !== undefined && metric !== null && typeof metric !== "string") fail("metric must be a string");
    if (metric != null && !Object.prototype.hasOwnProperty.call(metricById, metric)) {
      fail("metric must be available in the selected snapshot");
    }
    var selectedCountries = payload.countries == null ? [] : payload.countries;
    if (!Array.isArray(selectedCountries) || selectedCountries.length > 3 ||
        selectedCountries.some(function (code) { return typeof code !== "string" || !countryById[code]; }) ||
        new Set(selectedCountries).size !== selectedCountries.length) {
      fail("countries must contain up to three unique known economy identifiers");
    }
    selectedCountries = selectedCountries.slice();
    var startYear = payload.start_year === undefined ? lower : numberYear(payload.start_year, "start_year", lower, upper);
    var endYear = payload.end_year === undefined ? upper : numberYear(payload.end_year, "end_year", lower, upper);
    if (startYear > endYear) fail("start_year must not be after end_year");
    var selectedYear = payload.year == null ? null : numberYear(payload.year, "year", startYear, endYear);

    var text = payload.question.trim();
    var lowered = text.toLowerCase();
    var filters = { intent: "unsupported", metric: metric || null, countries: selectedCountries,
      year: selectedYear, start_year: startYear, end_year: endYear };
    function clarify(message) {
      return result(data, "clarification_required", message + " Resolved controls: metric=" +
        (filters.metric || "default") + "; countries=" +
        (filters.countries.length ? filters.countries.join(", ") : "all economies") +
        "; year=" + (filters.year == null ? "none" : filters.year) +
        "; window=" + filters.start_year + "-" + filters.end_year + ".", filters,
      resolveSource(data, filters.metric));
    }

    var mentionedYears = Array.from(new Set((lowered.match(/\b(?:19\d{2}|20\d{2}|2100)\b/g) || []).map(Number)));
    if (mentionedYears.length > 1) return clarify("The question names multiple years. Choose one year in the year control.");
    if (mentionedYears.length) {
      var mentionedYear = mentionedYears[0];
      if (mentionedYear < startYear || mentionedYear > endYear) {
        return clarify("The question names " + mentionedYear + ", outside the selected " + startYear + "-" + endYear + " window.");
      }
      if (selectedYear != null && selectedYear !== mentionedYear) {
        return clarify("The question names " + mentionedYear + ", but the selected year is " + selectedYear + ". Align the question or year control.");
      }
      if (selectedYear == null) selectedYear = mentionedYear;
      filters.year = selectedYear;
    }

    var metricMentions = uniqueMatches(lowered, metrics.reduce(function (all, item) {
      all.push({ id: item.id, phrase: item.id });
      all.push({ id: item.id, phrase: item.label || "" });
      return all;
    }, []));
    if (metricMentions.length > 1) return clarify("The question names more than one metric. Select a single metric.");
    if (metricMentions.length) {
      if (metric && metric !== metricMentions[0]) {
        return clarify("The question names " + metricMentions[0] + ", but the metric control selects " + metric + ". Align the question or metric control.");
      }
      metric = metricMentions[0];
    }
    if (!metric) metric = metrics.length ? metrics[0].id : null;
    filters.metric = metric;
    if (!metric) return result(data, "unsupported", "No metric metadata is available in this snapshot.", filters,
      resolveSource(data, null));

    var countryMentions = uniqueMatches(lowered, countries.map(function (item) {
      return { id: item.id, phrase: item.name };
    }));
    countries.forEach(function (item) {
      if (/^[A-Z]{3}$/.test(item.id) && new RegExp("(^|[^A-Za-z0-9])" + item.id + "(?=$|[^A-Za-z0-9])").test(text)) {
        countryMentions.push(item.id);
      }
    });
    countryMentions = Array.from(new Set(countryMentions));
    if (countryMentions.length > 3) {
      return clarify("The question names more than three economies. Select up to three in the country controls.");
    }
    if (countryMentions.length) {
      if (selectedCountries.length && (countryMentions.length !== selectedCountries.length ||
          countryMentions.some(function (code) { return selectedCountries.indexOf(code) < 0; }))) {
        return clarify("The question names " + countryMentions.sort().join(", ") + ", while the country controls select " +
          selectedCountries.join(", ") + ". Align the question or controls.");
      }
      if (!selectedCountries.length) selectedCountries = countryMentions.sort();
      filters.countries = selectedCountries;
    }

    var unsafePatterns = [
      /\b(caus(?:e|ed|es|al)|causality|effect of|impact of|why did|because)\b/,
      /\b(company|companies|acquisition|acquired|deal|merger|greenfield|subsidiary|project)\b/,
      /(?:https?:\/\/|file:\/\/|javascript:|<[^>]*>)/i,
      /\b(select|insert|update|delete|drop|union|pragma|attach|detach)\b/i
    ];
    if (unsafePatterns.some(function (pattern) { return pattern.test(text); })) {
      filters.intent = "unsupported";
      return result(data, "unsupported", "This tool answers descriptive questions from the selected World Bank snapshot. It cannot identify causes or answer company, deal, or project questions, and accepts no executable query, URL, file, or HTML input.", filters, resolveSource(data, metric));
    }

    var intentRules = [
      { intent: "method", pattern: /\b(method|definition|measure|what is)\b/ },
      { intent: "source", pattern: /\b(source|provenance|where does)\b/ },
      { intent: "missing", pattern: /\b(missing|gap|available|availability)\b/ },
      { intent: "latest", pattern: /\b(latest|most recent|current)\b/ },
      { intent: "ranking", pattern: /\b(rank|ranking|highest|lowest|top)\b/ },
      { intent: "change", pattern: /\b(change|growth|increased|decreased|between)\b/ },
      { intent: "comparison", pattern: /\b(compare|comparison|versus)\b|\bvs\b/ }
    ];
    var intents = intentRules.filter(function (rule) { return rule.pattern.test(lowered); });
    if (intents.length !== 1) {
      return result(data, "unsupported", intents.length
        ? "This question mixes multiple answer types. Ask one descriptive question at a time."
        : "I can answer latest values, same-year rankings, comparisons, changes, missingness, metric definitions, or sources.",
      filters, resolveSource(data, metric));
    }
    var intent = intents[0].intent;
    filters.intent = intent;

    var metricMeta = metricById[metric];
    var observations = Array.isArray(data.observations) ? data.observations.filter(function (row) {
      return row && row.metric === metric && (!selectedCountries.length || selectedCountries.indexOf(row.country) >= 0) &&
        countryById[row.country] && Number.isInteger(row.year) && (row.value === null ||
          (typeof row.value === "number" && Number.isFinite(row.value)));
    }) : [];
    var byCountry = Object.create(null);
    observations.forEach(function (row) {
      (byCountry[row.country] || (byCountry[row.country] = [])).push(row);
    });
    Object.keys(byCountry).forEach(function (code) { byCountry[code].sort(function (a, b) { return a.year - b.year; }); });
    var population = selectedCountries.length ? selectedCountries.slice() : countries.map(function (item) { return item.id; }).sort();
    var valueText = function (value) { return String(value); };

    if (intent === "method") {
      return result(data, "answered", (metricMeta.label || metric) + ": " +
        (metricMeta.description || "No additional methodology is recorded.") + " Unit: " +
        (metricMeta.unit || "not specified") + ". Frequency: " + (metricMeta.frequency || "annual") + ".",
      filters, resolveSource(data, metric));
    }
    if (intent === "source") {
      return result(data, "answered", "Recorded source for " + (metricMeta.label || metric) + ": " +
        (metricMeta.source_url || data.source || "Source unavailable."), filters, resolveSource(data, metric));
    }
    if (intent === "missing") {
      var years = selectedYear == null ? null : [selectedYear];
      var firstExpected = years ? years[0] : startYear;
      var lastExpected = years ? years[0] : endYear;
      var countExpected = lastExpected - firstExpected + 1;
      var missingParts = population.map(function (code) {
        var observed = Object.create(null);
        (byCountry[code] || []).forEach(function (row) {
          if (row.year >= firstExpected && row.year <= lastExpected) observed[row.year] = row.value;
        });
        var missing = 0;
        for (var year = firstExpected; year <= lastExpected; year += 1) {
          if (observed[year] == null) missing += 1;
        }
        return countryById[code].name + ": " + missing + " missing of " + countExpected + " expected (" +
          firstExpected + "-" + lastExpected + ")";
      });
      var missingAnswer = missingParts.slice(0, 10).join("; ") || "No economies are available in this snapshot.";
      if (missingParts.length > 10) missingAnswer += "; showing 10 of " + missingParts.length + " economies";
      return result(data, "answered", missingAnswer, filters, resolveSource(data, metric));
    }
    if (intent === "latest") {
      var latestEnd = Math.min(selectedYear == null ? endYear : selectedYear, endYear);
      filters.end_year = latestEnd;
      var latestValues = population.map(function (code) {
        var available = (byCountry[code] || []).filter(function (row) {
          return row.value !== null && row.year >= startYear && row.year <= latestEnd;
        });
        var row = available[available.length - 1];
        return row ? { code: code, value: row.value, year: row.year } : null;
      }).filter(Boolean).sort(function (a, b) { return b.value - a.value || a.code.localeCompare(b.code); });
      var latestAnswer = latestValues.slice(0, 10).map(function (row) {
        return countryById[row.code].name + ": " + valueText(row.value) + " (" + row.year + ")";
      }).join("; ") || "No non-missing observations match this selection.";
      if (latestValues.length > 10) latestAnswer += "; showing 10 of " + latestValues.length + " economies";
      return result(data, "answered", latestAnswer, filters, resolveSource(data, metric));
    }
    if (intent === "ranking") {
      var targetYear = selectedYear;
      if (targetYear == null) {
        var counts = Object.create(null);
        population.forEach(function (code) {
          (byCountry[code] || []).forEach(function (row) {
            if (row.year >= startYear && row.year <= endYear && row.value !== null) counts[row.year] = (counts[row.year] || 0) + 1;
          });
        });
        Object.keys(counts).map(Number).sort(function (a, b) { return b - a; }).some(function (year) {
          if (counts[year] >= Math.min(2, population.length)) { targetYear = year; return true; }
          return false;
        });
      }
      if (targetYear == null) {
        return result(data, "answered", "No common source year has non-missing values for the selected ranking population.",
          filters, resolveSource(data, metric));
      }
      filters.year = targetYear;
      var ranked = population.map(function (code) {
        var row = (byCountry[code] || []).find(function (item) { return item.year === targetYear; });
        return row && row.value !== null ? { code: code, value: row.value } : null;
      }).filter(Boolean).sort(function (a, b) { return b.value - a.value || a.code.localeCompare(b.code); });
      if (/\blowest\b/.test(lowered)) ranked.reverse();
      var direction = /\blowest\b/.test(lowered) ? "lowest" : "highest";
      var focus = selectedCountries.length ? "selected economies" : "all economies in the snapshot";
      var rankingAnswer = (metricMeta.label || metric) + " same-year " + direction + " ranking for " + targetYear +
        " across " + population.length + " " + focus + " (" + ranked.length + " reported): " +
        (ranked.slice(0, 10).map(function (item) { return countryById[item.code].name + " " + valueText(item.value); }).join(", ") ||
          "no non-missing observations");
      return result(data, "answered", rankingAnswer, filters, resolveSource(data, metric));
    }
    if (intent === "change") {
      var changeEnd = Math.min(selectedYear == null ? endYear : selectedYear, endYear);
      filters.end_year = changeEnd;
      var percentage = String(metricMeta.unit || "").indexOf("%") >= 0;
      var changeParts = population.map(function (code) {
        var available = (byCountry[code] || []).filter(function (row) {
          return row.value !== null && row.year >= startYear && row.year <= changeEnd;
        });
        if (available.length < 2) return null;
        var first = available[0];
        var last = available[available.length - 1];
        var delta = last.value - first.value;
        var label = percentage ? "percentage-point change" : "nominal change in " + (metricMeta.unit || "original units");
        return countryById[code].name + ": " + valueText(first.value) + " (" + first.year + ") to " +
          valueText(last.value) + " (" + last.year + "), " + label + " " + (delta >= 0 ? "+" : "") +
          Number(delta.toPrecision(6));
      }).filter(Boolean);
      var changeAnswer = changeParts.slice(0, 10).join("; ") || "At least two non-missing years are needed inside the selected window.";
      if (changeParts.length > 10) changeAnswer += "; showing 10 of " + changeParts.length + " economies";
      return result(data, "answered", changeAnswer, filters, resolveSource(data, metric));
    }

    // Comparison questions use a single common year across the explicit focus or full population.
    var commonYear = selectedYear;
    if (commonYear == null) {
      var commonCounts = Object.create(null);
      population.forEach(function (code) {
        (byCountry[code] || []).forEach(function (row) {
          if (row.year >= startYear && row.year <= endYear && row.value !== null) commonCounts[row.year] = (commonCounts[row.year] || 0) + 1;
        });
      });
      Object.keys(commonCounts).map(Number).sort(function (a, b) { return b - a; }).some(function (year) {
        if (commonCounts[year] >= Math.min(2, population.length)) { commonYear = year; return true; }
        return false;
      });
    }
    filters.year = commonYear;
    var compared = commonYear == null ? [] : population.map(function (code) {
      var row = (byCountry[code] || []).find(function (item) { return item.year === commonYear; });
      return countryById[code].name + ": " + (row && row.value !== null ? valueText(row.value) : "missing");
    });
    var compareAnswer = commonYear == null ? "no common-year observations" : compared.slice(0, 10).join("; ");
    if (compared.length > 10) compareAnswer += "; showing 10 of " + compared.length + " economies";
    return result(data, "answered", (metricMeta.label || metric) + " in " + commonYear + ": " + compareAnswer,
      filters, resolveSource(data, metric));
  }

  root.EMIQuestions = { answer: answer };
}(typeof window !== "undefined" ? window : globalThis));
