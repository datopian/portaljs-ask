Tables (DuckDB). Snapshot downloaded from the UKHSA data dashboard API (api.ukhsa-dashboard.data.gov.uk) on 2026-10-26.
All figures are England and UKHSA's 9 regions: 'East Midlands', 'East of England', 'London', 'North East', 'North West',
'South East', 'South West', 'West Midlands', 'Yorkshire and Humber'. These are the published figures exactly as UKHSA
releases them: never present an answer as a forecast, a diagnosis or medical advice, and never call a figure "official
analysis"; say "UKHSA's published figures show ...".

weekly  -- flu and RSV surveillance, one row per virus, measure, geography and week (all ages)
  virus        VARCHAR  -- 'Flu' or 'RSV'
  measure      VARCHAR  -- 'test positivity', 'hospital admissions', 'ICU/HDU admissions' (ICU/HDU is flu only)
  unit         VARCHAR  -- '% of tests positive' for test positivity; 'per 100,000 people' for both admission measures
  geography    VARCHAR  -- 'England' or one of the 9 regions above
  week_start   DATE     -- Monday the week starts; latest week for every series is 2026-10-12
  value        DOUBLE   -- the figure in `unit`. NULL = not collected (see traps)
  provisional  BOOLEAN  -- UKHSA's "in reporting delay period" flag; false for every row in this snapshot
  ukhsa_metric VARCHAR  -- UKHSA's own metric name, e.g. 'influenza_healthcare_hospitalAdmissionRateByWeek'
  Coverage:
    Flu test positivity       England and all 9 regions, 2017-07-03 to 2026-10-12. England range 0 to 32.64%.
    Flu hospital admissions   England from 2015-09-28 (peak 18.09 per 100k, week of 2022-12-19), regions from 2020-09-28.
    Flu ICU/HDU admissions    England from 2015-10-05 (max 0.64 per 100k), regions from 2020-10-05.
    RSV test positivity       England and all 9 regions, 2017-07-03 to 2026-10-12.
    RSV hospital admissions   ENGLAND ONLY, from 2020-10-26. There are no regional RSV admissions.
  Traps:
    - Always filter both virus AND measure, and say which measure you used. Never add or average positivity with admissions:
      they are different units. To show "are admissions following positivity", put them side by side (two series), not summed.
    - Admission rates are per 100,000 people, not counts. Don't convert them to numbers of patients.
    - Before 2021-10-01 admissions were only collected in the flu season; off-season weeks are NULL. Since late 2021 the
      admission series run all year. For "this time last year" compare the same week_start window one year earlier
      (e.g. 2025-09-01 to 2025-10-13 vs 2026-08-31 to 2026-10-12).
    - Seasons: UKHSA's flu season runs from about week 40 (early October) to week 20 (mid May). "This season" = since 2026-09-28.
    - REGIONAL FIGURES ARE NOISY. Regional positivity comes from small numbers of tests: London flu positivity goes
      0 -> 11.11 -> 14.29 -> 25.0 -> 0 -> 0 -> 14.29 over Aug-Oct 2026 (14.29% = 1 positive in 7). Regional admissions come
      from a few sentinel hospitals and some region-weeks are missing (no row), e.g. South West 2026-09-07, West Midlands
      2026-10-12. East Midlands and North West show 0 admissions for several weeks in Aug-Sep 2026, which looks like no
      reporting rather than no flu. So: never rank regions on a single week, and never compute a % change from a 0 base.
      Compare regions on the LEVEL of the average of the latest 4 weeks (2026-09-21 to 2026-10-12), say that regional
      figures are based on small samples, and use England for any headline.
    - The latest week can move a little when UKHSA revises it; say "as published on 26 Oct 2026".
  Latest England flu (week starting 2026-10-12): positivity 5.99%, hospital admissions 1.94 per 100k, ICU/HDU 0.08 per 100k.
  Same week a year earlier (2025-10-13): positivity 7.53%, admissions 2.25 per 100k.

admissions_by_age  -- flu and RSV hospital admission rates in England by age group, one row per virus, age group and week
  virus               VARCHAR  -- 'Flu' or 'RSV'
  age_group           VARCHAR  -- '00-04', '05-14', '15-44', '45-54', '55-64', '65-74', '75-84', '85+' (8 groups, no overlap)
  week_start          DATE     -- 2020-09-28 to 2026-10-12
  admissions_per_100k DOUBLE   -- admissions per 100,000 people IN THAT AGE GROUP. NULL before 2021-10-01 off-season.
  provisional         BOOLEAN  -- false for every row
  ukhsa_metric        VARCHAR
  Traps:
    - These are rates within each age group. You can compare age groups with each other, but never add them up or average
      them to get an England figure; use weekly (geography = 'England') for the all-ages rate.
    - The age bands are uneven (15-44 is 30 years wide, 85+ is open-ended). Talk about rates, not "how many people".
    - COVID-19 lockdowns disrupted the usual seasons. Flu almost vanished in 2020-21. RSV had an unusual SUMMER wave in
      2021: under-5 RSV admissions peaked at 35.03 per 100k in the week of 2021-08-09, outside any Oct-Mar winter. When
      comparing RSV across winters, either use Sep-Aug seasons or say that the 2021 wave came in summer; never describe
      2021 as a small RSV year or claim peaks "have grown" from 2021/22.
    - Week-to-week values for small groups bounce; for "which age group is most affected this autumn" average the
      latest 4 weeks (flu, 2026-09-21 to 2026-10-12: 85+ 8.42, 75-84 4.86, 65-74 3.53, 00-04 1.86 per 100k).

covid_daily  -- COVID-19 surveillance, one row per measure, geography and day
  measure      VARCHAR  -- 'test positivity', 'hospital admissions', 'patients in hospital'
  unit         VARCHAR  -- test positivity: '% of tests positive, 7-day rolling';
                        -- hospital admissions: 'admissions per day, 7-day average' (a COUNT of people, not a rate);
                        -- patients in hospital: 'beds occupied, 7-day average' (a count)
  geography    VARCHAR  -- test positivity: England and all 9 regions. Admissions and patients in hospital: ENGLAND ONLY.
  day          DATE     -- positivity 2020-02-08 to 2026-10-19; admissions and beds 2020-08-07 to 2026-09-30
  value        DOUBLE
  provisional  BOOLEAN  -- false for every row
  ukhsa_metric VARCHAR
  Traps:
    - Every value is already a 7-day rolling figure. Don't sum days. For a weekly or monthly figure, take the value on the
      last day, or average the daily values; never sum them.
    - COVID admissions are counts per day; flu and RSV admissions (weekly table) are rates per 100,000. Don't compare
      COVID admission numbers with flu admission rates directly. Positivity (%) can be compared across viruses, with the
      caveat that the tests behind each virus differ.
    - Admissions and beds end on 2026-09-30, positivity on 2026-10-19: state the latest date you used.
    - Early 2020 regional positivity has zeros from very low testing; for trends start from 2020-09-01.
  Latest England: positivity 9.11% (2026-10-19), admissions 166.86 per day and 930.14 beds occupied (2026-09-30).
  Pandemic peaks dwarf everything since (beds max 33,594); when comparing recent seasons, start from 2023-09-01.

There is no data on deaths, vaccination, testing volumes, hospital names, or anywhere outside England.
