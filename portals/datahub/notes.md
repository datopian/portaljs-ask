Tables (DuckDB). Snapshot of DataHub core datasets (datahub.io/core), downloaded on 6 Oct 2026.

gdp  -- GDP by country, region and world (World Bank), one row per country per year, 1960-2023
  country       VARCHAR  -- e.g. 'United States', 'China', 'World', 'Euro area', 'High income'
  country_code  VARCHAR  -- ISO 3166-1 alpha-3 ('USA', 'CHN') or a World Bank group code ('WLD' = World)
  is_aggregate  BOOLEAN  -- TRUE for the 48 regions and income groups (World, Euro area, High income, Arab World ...)
  year          INTEGER
  gdp_usd       DOUBLE   -- GDP in current US dollars (not adjusted for inflation). Show as trillions or billions.
  Notes: to rank or compare countries, ALWAYS add WHERE NOT is_aggregate, or "World" and "High income" top every list.
    Current dollars: growth over long periods includes inflation; say "in current dollars".

population  -- Population by country, region and world (World Bank), one row per country per year, 1960-2025
  country, country_code, is_aggregate  -- as in gdp
  year          INTEGER
  population    BIGINT
  Notes: same aggregate rule as gdp. GDP per person = gdp_usd / population, joined on country_code and year.

inflation  -- Consumer price inflation by country (World Bank), one row per country per year, 1961-2023
  country, country_code, is_aggregate  -- as in gdp
  year          INTEGER
  inflation_pct DOUBLE   -- annual % change in consumer prices; some years are very large (hyperinflation)
  Notes: same aggregate rule as gdp. Countries report different years: say which years a comparison covers.

co2_monthly  -- Carbon dioxide in the atmosphere at Mauna Loa, Hawaii (NOAA), one row per month, March 1958 to August 2026
  month          DATE    -- first day of the month
  co2_ppm        DOUBLE  -- monthly average, parts per million
  co2_ppm_trend  DOUBLE  -- seasonally adjusted. Use this for trends (co2_ppm rises and falls every year with the seasons).
co2_annual  -- the same, annual mean, 1959-2025
  year INTEGER, co2_ppm DOUBLE

co2_emissions  -- Global CO2 emissions from fossil fuels and cement (Global Carbon Project / CDIAC), one row per year, 1750-2024
  year                INTEGER
  total_mt_carbon     DOUBLE  -- million metric tonnes of CARBON, not CO2. Multiply by 3.664 for tonnes of CO2 (2024: about 10,500 Mt carbon = 38.6 billion tonnes CO2).
  gas, liquid, solid, cement, flaring  DOUBLE  -- the same, by source (liquid = oil, solid = coal), million tonnes of carbon
  per_capita_t_carbon DOUBLE  -- tonnes of carbon per person (2024: 1.29)
  Notes: always say which unit you show ("million tonnes of carbon" or, after converting, "tonnes of CO2").

temperature  -- Global average surface temperature anomaly, one row per source per year
  source      VARCHAR  -- 'GISTEMP' (NASA, 1880-2025, compared with 1951-1980) or 'GCAG' (NOAA, 1850-2026, compared with the 20th-century average)
  year        INTEGER
  anomaly_c   DOUBLE   -- degrees Celsius above (+) or below (-) the source's baseline average
  Notes: ALWAYS filter to ONE source (default WHERE source = 'GISTEMP'), or every year appears twice.
    The latest GCAG year can be partial. Say "above the 1951-1980 average" for GISTEMP.
temperature_monthly  -- the same by month: source VARCHAR, month DATE, anomaly_c DOUBLE. GISTEMP to Dec 2025, GCAG to Jul 2026.

sea_level  -- Global average sea level change since 1880 (US EPA), one row per year
  year          INTEGER
  csiro_inches  DOUBLE  -- cumulative change in inches since 1880, CSIRO reconstruction, 1880-2013
  noaa_inches   DOUBLE  -- satellite measurements (NOAA), 1993-2023; on a different baseline, don't mix the two in one series
  Notes: 1 inch = 2.54 cm.

glaciers  -- Average cumulative mass balance of the world's reference glaciers (WGMS via US EPA), one row per year, 1956-2023
  year                        INTEGER
  cumulative_mass_balance_mwe DOUBLE   -- metres of water equivalent lost (negative) since 1956 (= 0); 2023: -29.7
  observations                INTEGER  -- glaciers measured that year

oil_prices  -- Crude oil spot prices (US EIA), one row per benchmark per month
  benchmark       VARCHAR  -- 'Brent' (from May 1987) or 'WTI' (from Jan 1986)
  month           DATE     -- dated the 15th; use date_trunc('month', month) or year(month)
  usd_per_barrel  DOUBLE   -- nominal US dollars
  Notes: filter to one benchmark unless comparing them.
gas_prices  -- Henry Hub natural gas spot price (US EIA), monthly, Jan 1997 to Aug 2026
  month DATE, usd_per_mmbtu DOUBLE  -- US dollars per million British thermal units
gold_prices  -- Gold price, monthly, 1833 to Sep 2026
  month DATE, usd_per_ounce DOUBLE  -- nominal US dollars per troy ounce

sp500  -- S&P 500 index (Robert Shiller), monthly, Jan 1871 to Sep 2026
  month        DATE
  sp500        DOUBLE  -- index level (monthly average)
  dividend, earnings  DOUBLE  -- per share, 12-month; earnings end in mid-2023 (NULL after)
  real_price   DOUBLE  -- index adjusted for inflation
  pe10         DOUBLE  -- cyclically adjusted price/earnings ratio (CAPE); NULL before 1881 and after Sep 2023
  Notes: long-run comparisons are fairer with real_price; say "adjusted for inflation".

us_house_prices  -- S&P CoreLogic Case-Shiller home price index, not seasonally adjusted, one row per area per month
  month  DATE     -- 1987-01 to 2026-07
  area   VARCHAR  -- 'US national', '20-city composite', '10-city composite', or a metro as 'STATE-City', e.g. 'CA-San Francisco', 'NY-New York', 'FL-Miami'
  index  DOUBLE   -- January 2000 = 100 (so 300 means prices tripled since 2000)
  Notes: areas end in different months (US national: Jul 2026, most cities: Jun 2026): for "latest" use each area's own last month, e.g. arg_max(index, month) per area, never month = (SELECT max(month) ...).
    These start later than 1987: Phoenix and Minneapolis 1989, Seattle 1990, Detroit 1991, Dallas and the 20-city composite 2000.
    Show the area as the city name ('San Francisco'), e.g. regexp_replace(area, '^[A-Z]{2}-', '').

us_bond_yield  -- US 10-year government bond yield (Federal Reserve), monthly, Apr 1953 to Aug 2026
  month DATE, yield_pct DOUBLE  -- percent per year

exchange_rates  -- Foreign exchange rates against the US dollar (Federal Reserve), monthly, 1971 to Sep 2026
  month    DATE
  country  VARCHAR  -- e.g. 'Euro', 'United Kingdom', 'Japan', 'China', 'Canada', 'India', 'Switzerland'
  rate     DOUBLE   -- units of that currency for ONE US dollar (Euro 2025: 0.887 euros per dollar). A higher number means a stronger dollar.
  Notes: euro countries (Germany, France, Italy, Spain ...) stop in Dec 2001 and 'Euro' starts in Jan 1999: use 'Euro' for recent years.
    Venezuela's rate has huge jumps from currency redenominations; leave it out of comparisons.

us_employment  -- US employment status of the civilian population (Bureau of Labor Statistics), one row per year, 1941-2025
  year                             INTEGER
  population_thousands             BIGINT  -- civilian non-institutional population, thousands (age 16+ from 1947; 14+ before)
  labor_force_thousands, employed_thousands, unemployed_thousands  BIGINT  -- thousands of people
  unemployment_rate_pct            DOUBLE  -- percent of the labour force
  employment_population_ratio_pct  DOUBLE  -- percent of the population with a job
  Notes: annual averages; 1941-1946 use the older 14+ definition, so start trends in 1947.

vix  -- CBOE Volatility Index ("fear index"), monthly closing value, Jan 1990 to Sep 2026
  month DATE  -- dated the last trading day; use date_trunc('month', month) or year(month)
  vix   DOUBLE

General notes:
- The latest year in many monthly tables is partial (2026): leave it out of year-on-year comparisons or say "so far".
- Money values are nominal (not adjusted for inflation) unless the column says real.

Writing notes:
- Say which source and unit a number is in (current US dollars, million tonnes of carbon, degrees above the 1951-1980 average).
- Things these tables don't have, never to be suggested as follow-ups: anything by city outside the US house price index, forecasts, causes of change.
