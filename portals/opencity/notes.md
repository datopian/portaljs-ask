Tables (DuckDB). Snapshot downloaded from data.opencity.in (OpenCity – Urban Data Portal, run by Oorvani Foundation) on
2026-11-03. OpenCity collects and republishes data from government bodies (BBMP/GBA, Greater Chennai Corporation, Pune and
Mumbai municipal corporations, pollution control boards, the Election Commission, Karnataka Police and others). Always say
where a figure comes from, e.g. "BBMP grievance records published on OpenCity show ...", never "OpenCity found ...".
Numbers: use Indian groupings only if the question does; otherwise write 1.2 million, 45,000. Units are as published.

air_quality_daily  -- daily averages from Bengaluru, Chennai and Pune's continuous air-quality monitoring stations (CPCB /
                      state pollution control boards), one row per station and day, 2024-01-01 to 2025-12-31
  city              VARCHAR  -- 'Bengaluru' (13 stations), 'Chennai' (9), 'Pune' (12)
  station           VARCHAR  -- short name, e.g. 'Silk Board', 'Hebbal', 'Arumbakkam', 'Manali', 'Alandur Bus Depot',
                             -- 'Karve Road', 'Hadapsar', 'Savitribai Phule Pune University'. 'Manali' and 'Manali Village' are two
                             -- different Chennai stations.
  station_full_name VARCHAR  -- as published, with the operator, e.g. 'Silk Board, Bengaluru - KSPCB'
  day               DATE     -- 2024-01-01 to 2025-12-31
  pm25              DOUBLE   -- daily average PM2.5, micrograms per cubic metre (ug/m3)
  pm10              DOUBLE   -- daily average PM10, ug/m3
  no2               DOUBLE   -- daily average nitrogen dioxide, ug/m3
  ozone             DOUBLE   -- daily average ozone, ug/m3
  co                DOUBLE   -- daily average carbon monoxide, mg/m3 (milligrams, not micrograms)
  How the daily values were made: averages of the published 15-minute readings. A pollutant's daily value is NULL unless it
    had at least 64 readings (16 hours, CPCB's rule for a valid 24-hour average). PM2.5 is also NULL when it is higher than the
    same day's PM10, which is physically impossible and means a faulty sensor. So NULL = no valid measurement, never zero.
  Traps:
    - COVERAGE IS UNEVEN. Every station has gaps. 'City Railway Station' and 'Sanegurava Halli' (Bengaluru) have no PM2.5 at
      all (PM10 only). 'Gandhi Nagar_Ennore' (Chennai) has only 64 valid PM2.5 days, none in winter 2024-25; 'Dhankawadi'
      (Pune) only starts in 2025; 'Hadapsar' and 'Alandi' (Pune) have under 300. When ranking stations, show how many valid days
      each has (count(pm25)) and leave out stations with fewer than 60 valid days in the period.
    - City averages = avg(pm25) over all station-days in that city. Say it is an average across that city's stations.
    - Standards: India's 24-hour standard for PM2.5 is 60 ug/m3 (annual 40); for PM10 100 (annual 60). The WHO 2021
      guideline for PM2.5 is 15 (24-hour) and 5 (annual). Say which one you compare against. "Days above the standard" =
      count(*) FILTER (WHERE pm25 > 60), counted per station-day.
    - Air is worst in winter (Nov-Feb) in all three cities and cleanest in the monsoon (Jun-Sep). "Last winter" = 2024-11-01 to
      2025-02-28 (the only complete winter here). Winter 2024-25 PM2.5 averages: Pune 60.2, Bengaluru 38.1, Chennai 38.1.
      Chennai's worst winter stations: Arumbakkam 46.1, Perungudi 44.9, Royapuram 41.1 (Kodungaiyur is lowest, 14.2).
    - Whole-period PM2.5 averages: Pune 39.9, Bengaluru 30.8, Chennai 29.2. Pune had 695 station-days above 60 in 2025,
      Chennai 225, Bengaluru 173 (different numbers of stations: compare shares, not counts).
    - Diwali (1 Nov 2024, 20 Oct 2025) and Bhogi (around 13-14 Jan, Chennai) cause one-day spikes.
    - This is the AQI monitoring data as published, not the official AQI index: never call pm25 "the AQI".

bbmp_grievances  -- BBMP (Bengaluru) citizen grievances, one row per complaint, 2020-02-08 to 2025-06-19
  complaint_id   VARCHAR  -- unique
  category       VARCHAR  -- 32 departments, e.g. 'Electrical' (310,128), 'Solid Waste (Garbage) Related' (195,153),
                          -- 'Road Maintenance(Engg)' (111,535), 'Forest', 'Health Dept', 'veterinary', 'Storm  Water Drain(SWD)'
                          -- (two spaces). Match with ILIKE, e.g. category ILIKE '%garbage%'.
  sub_category   VARCHAR  -- 181 values, e.g. 'Street Light Not Working' (293,580, the single largest), 'Garbage vehicle not
                          -- arrived', 'Garbage dump', 'Potholes', 'Road side drains', 'Sweeping not done'
  grievance_date DATE     -- the day the complaint was filed. The source's times are on a 12-hour clock with no AM/PM, so
                          -- there is NO time-of-day in this table: never answer "what hour" questions from it.
  ward_name      VARCHAR  -- one of BBMP's 198 old wards (as used before the 2025 GBA delimitation), e.g. 'Horamavu', 'Begur'
                          -- 2025 also has 'NON Ward' (complaints not tied to a ward): leave it out of ward rankings
  status         VARCHAR  -- 'Closed' (91.5%), 'Registered', 'Rejected', 'Non Relevant', 'Resolved', 'ReOpen', 'In Progress', ...
  Notes: count complaints with count(*). Complete years are 2021-2024. 2020 starts on 8 Feb and 2025 ends on 19 Jun: leave
    them out of year-on-year totals, or compare the same months. Complaints jumped from 119,140 (2023) to 207,016 (2024);
    that is a change in how many were filed through BBMP's system, not proof that problems doubled: say "complaints filed".
    Monsoon months (May-Oct) get more complaints. Wards differ in size and population, so a ward with more complaints is not
    necessarily worse served; there is no population in this table. Ward names here do NOT match gba_wards_2025 (new wards).
    Staff names and remarks were left out on purpose.

tn_assembly_2026  -- Tamil Nadu Legislative Assembly election results, May 2026, one row per candidate per constituency
  ac_no          INTEGER  -- assembly constituency number, 1-234
  ac_name        VARCHAR  -- upper case, e.g. 'GUMMIDIPOONDI'
  candidate      VARCHAR  -- 'NOTA' for None of the Above
  party          VARCHAR  -- full names, e.g. 'Tamilaga Vettri Kazhagam', 'Dravida Munnetra Kazhagam', 'All India Anna Dravida
                          -- Munnetra Kazhagam', 'Indian National Congress', 'Naam Tamilar Katchi', 'Independent' (2,209 rows),
                          -- 'None of the Above' (one row per constituency)
  evm_votes, postal_votes, total_votes  BIGINT
  vote_share_pct DOUBLE   -- share of the votes in that constituency, as published
  position       BIGINT   -- 1 = winner in that constituency (computed from total_votes)
  Notes: seats won = count(*) WHERE position = 1 (234 seats: TVK 108, DMK 59, AIADMK 47, INC 5, PMK 4, ...). Statewide vote
    share = sum(total_votes) by party / sum(total_votes) of all rows (49,324,121 including 199,801 NOTA). Never average
    vote_share_pct across constituencies. Margin = winner's total_votes minus the runner-up's (position 2). Closest seat:
    TIRUPPATTUR, won by Tamilaga Vettri Kazhagam over the DMK by 1 vote; next VEPPANAHALLI (138), KANNIYAKUMARI (214). Don't count 'Independent' as one party. This table has results only, no alliances:
    don't describe alliance totals unless the question names the parties to add up.

ward_winners_2026  -- winners of the January 2026 municipal elections in Pune (PMC) and Mumbai (BMC), one row per seat
  city          VARCHAR  -- 'Pune (PMC)' or 'Mumbai (BMC)'
  ward_no       INTEGER  -- Pune: 41 multi-member wards (prabhags), each with 3-5 seats (165 seats). Mumbai: 227 single-seat wards.
  ward_name     VARCHAR  -- Pune only, e.g. 'Kalas-Dhanori-Lohegaon'; NULL for Mumbai
  seat          VARCHAR  -- Pune only: 'A', 'B', 'C', 'D', ...
  reservation   VARCHAR  -- Pune only: e.g. 'SC (Women)', 'OBC (Women)', 'General', 'ST'
  winner        VARCHAR
  party         VARCHAR  -- full names in both cities: 'Bharatiya Janata Party', 'Shiv Sena (Uddhav Balasaheb Thackeray)',
                          -- 'Shiv Sena', 'Indian National Congress', 'Nationalist Congress Party', 'Nationalist Congress Party
                          -- Sharadchandra Pawar', 'All India Majlis-e-Ittehadul Muslimeen', 'Maharashtra Navnirman Sena', 'Samajwadi Party'
  winner_votes  BIGINT   -- Mumbai only: valid votes for the winner. NULL for Pune.
  Notes: seats won = count(*). Pune: BJP 118 of 165; Mumbai: BJP 89 of 227. Shiv Sena and Shiv Sena (UBT) are different
    parties, as are NCP and NCP (Sharadchandra Pawar). Only winners are listed: no runner-up, turnout or vote share.
    Compare cities by share of seats, not seat counts (165 vs 227).

gba_wards_2025  -- Bengaluru's new wards under the Greater Bengaluru Authority's 2025 draft delimitation, one row per ward
  corporation           VARCHAR  -- the five new city corporations: 'Central', 'East', 'North', 'South', 'West'
  assembly_constituency VARCHAR  -- e.g. 'C.V. RamannNagar' (spelling as published)
  ward_no               INTEGER  -- numbered within each corporation, so (corporation, ward_no) is the key
  ward_name             VARCHAR  -- e.g. 'Indiranagar'
  population            INTEGER  -- 2011 Census population re-cut to the new ward; 13,969 to 29,756, mean 22,826
  male, female          INTEGER
  sc_population, st_population INTEGER  -- Scheduled Caste / Scheduled Tribe population
  zone                  VARCHAR  -- two zones per corporation, e.g. Central: 'Gandhinagar', 'C.V. Raman Nagar'
  division              VARCHAR
  Notes: 368 wards, total 8.40 million people (2011 Census base, not today's population: say so). Wards per corporation:
    West 111, North 72, South 72, Central 63, East 50. These are new wards and do not match bbmp_grievances' ward names.

chennai_metro_ridership  -- Chennai Metro Rail passengers per month, April 2023 to June 2026
  month                   DATE    -- first day of the month
  total_riders            BIGINT  -- total passenger flow that month
  closed_loop_card_riders BIGINT  -- CMRL travel card
  qr_ticket_riders        BIGINT  -- QR tickets (app, WhatsApp, paper QR)
  ncmc_card_riders        BIGINT  -- National Common Mobility Card (Singara Chennai card)
  Notes: the three ticket types add up to total_riders. Busiest month: July 2025 (10.47 million). 2023 starts in April and
    2026 ends in June, so only 2024 and 2025 are complete years (2025: 112.1 million). These are journeys, not people.

chennai_reservoirs  -- storage in Chennai's five drinking-water reservoirs, one row per reservoir and month, 2003-2021
  reservoir     VARCHAR  -- 'Poondi', 'Cholavaram', 'Red Hills (Puzhal)', 'Chembarambakkam', 'Veeranam'
  year, month   INTEGER  -- month 1-12
  storage_mcft  DOUBLE   -- water stored, in million cubic feet (mcft), as published. Highest values: Chembarambakkam 3,470,
                          -- Red Hills 3,254, Poondi 3,231, Veeranam 1,465, Cholavaram 881.
  Notes: the series ends in December 2021; say so for any "now" question. Total city storage = sum over the five reservoirs
    for the same month. Veeranam is about 200 km south of Chennai and pipes water to the city. 2016-2019 are the drought years
    that ended in the 2019 "Day Zero" crisis. The four reservoirs near the city (all but Veeranam) held 16 mcft in Aug and Sep
    2019 (June 2019: Poondi 56, Red Hills 3, Cholavaram 1, Chembarambakkam 1), but they were even lower in Sep 2004 (1.2 mcft),
    so never call 2019 the lowest on record in this table. Veeranam still held 757 mcft in June 2019.

rainfall_monthly  -- monthly rainfall in Bengaluru (1901-2025) and Chennai (1901-2021), one row per city, year and month
  city         VARCHAR  -- 'Bengaluru' or 'Chennai'
  year, month  INTEGER
  rainfall_mm  DOUBLE   -- millimetres that month
  Notes: annual rainfall = sum per year. Chennai's values are long decimals (an area average), round them. Chennai gets most of
    its rain from the northeast monsoon (Oct-Dec); Bengaluru from both monsoons, wettest Sep-Oct. Chennai ends in 2021, so
    only compare the two cities up to 2021. Bengaluru: 1,890 mm in 2022, 1,045 mm in 2025. Bengaluru's long-period average
    (LPA, 1991-2020, published with the data) is 1,077.1 mm a year (December 1950 is missing, so leave 1950 out of totals); use it for "normal" ("above/below normal"). Wettest years:
    2022 (1,890), 2017 (1,696), 2021 (1,511).

bengaluru_domestic_flights  -- passengers and freight between Bengaluru airport and each Indian destination, one row per
                               destination and month, April 2015 to October 2025 (DGCA figures)
  month               DATE    -- first day of the month
  origin              VARCHAR -- always 'BENGALURU'
  destination         VARCHAR -- city, upper case, 84 of them, e.g. 'DELHI', 'MUMBAI', 'HYDERABAD', 'KOLKATA', 'PUNE', 'GOA'.
                              -- Renamed airports were merged: 'GOA' = Dabolim + Mopa (both Goa airports); 'PRAYAGRAJ' includes
                              -- 'ALLAHABAD'; 'KOCHI' includes 'COCHIN'; 'PUDUCHERRY' includes 'PONDICHERRY'; 'KADAPA' includes
                              -- 'CUDDAPAH'. 'HINDON (GHAZIABAD)' is a separate Delhi-region airport from 'DELHI' (2025 only).
  destination_as_published VARCHAR -- the name exactly as in the source file
  passengers_out      DOUBLE  -- passengers flying Bengaluru -> destination
  passengers_in       DOUBLE  -- passengers flying destination -> Bengaluru
  freight_out_tonnes, freight_in_tonnes DOUBLE  -- tonnes. Freight is only published from 2018 (incomplete in 2018): NULL before;
                                                 -- compare freight from 2019 on
  Notes: route traffic = passengers_out + passengers_in. MISSING MONTHS in the source: May 2021, May 2024, Jan-Mar 2015 and
    Nov-Dec 2025 are not in the data. Complete years: 2016-2020, 2022, 2023. For year-on-year comparisons use complete years or
    the same months in both years, and say so. 2020-21 show the COVID-19 collapse (28.73 million passengers on these routes
    in 2019, 12.44 million in 2020; 32.54 million in 2023, the busiest complete year). Busiest route in 2025: Delhi (3.75
    million passengers both ways, Jan-Oct); over 2015-2025: Delhi 40.1 million, Mumbai 34.1 million, Hyderabad 18.2 million.
    These are passengers on routes to and from Bengaluru only, not the airport's total traffic.

karnataka_crime_districts_2025  -- crimes registered by Karnataka Police in 2025, one row per police unit
  unit           VARCHAR  -- 6 city commissionerates ('Bengaluru City', 'Mysuru City', 'Hubballi Dharwad City', 'Mangaluru City',
                          -- 'Belagavi City', 'Kalaburagi City'), 31 district units and 'Karnataka Railways'
  police_range   VARCHAR  -- 'Commissionerates', 'Central Range', 'Eastern Range', ..., 'Railways'
  ipc_bns_crimes INTEGER  -- cases under the Indian Penal Code / Bharatiya Nyaya Sanhita (which replaced the IPC in July 2024)
  sll_crimes     INTEGER  -- cases under Special and Local Laws (e.g. excise, narcotics, gambling)
  Notes: units add up to the state totals: 138,666 IPC/BNS and 63,867 SLL. A city commissionerate and its district are
    separate units ('Bengaluru City' 37,181 vs 'Bengaluru Dist' 6,433), so never add them as "the same place" without saying
    so. These are cases registered, not crime rates: there is no population here.

bengaluru_traffic_offences  -- cases booked by Bengaluru Traffic Police under the Motor Vehicles Act, one row per offence and year
  offence  VARCHAR  -- e.g. 'Rider- without Helmet', 'Pillion Rider- without Helmet', 'Wrong parking', 'Jumping traffic signal',
                    -- 'Without Safety belt', 'Over speeding', 'Reckless driving', 'Others'
  year     INTEGER  -- 2018-2025
  cases    BIGINT
  Notes: 2023 and 2025 list only 27 offences (13 minor offences such as 'Black film' and 'Shrill horn' have no figure those
    years), so for totals across years compare the same offences, or say the totals cover the offences listed. Helmet offences
    dominate: 'Rider- without Helmet' was 4.0 million cases in 2023. Counts are cases booked, which depend on enforcement
    drives and automated cameras, not only on how people drive.
