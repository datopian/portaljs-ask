Tables (DuckDB). Snapshot downloaded from open.toronto.ca on 4-5 Oct 2026. Wards are Toronto's 25 city wards.

ferry  -- Toronto Island Ferry Ticket Counts, one row per 15-minute interval
  ts               TIMESTAMP  -- start of the 15-minute interval, 2015-05-01 to 2026-10-02
  tickets_redeemed INTEGER    -- tickets used = people boarding a ferry to the islands. Use this for ridership.
  tickets_sold     INTEGER    -- tickets sold in that interval
  Notes: each row is ONE 15-MINUTE INTERVAL, so avg(tickets_redeemed) is riders per 15 minutes, not per day.
    For riders per day: sum per day first, then average the daily totals, e.g.
      SELECT avg(day_total) FROM (SELECT date_trunc('day', ts) AS d, sum(tickets_redeemed) AS day_total FROM ferry GROUP BY 1)
    For riders per year or month: sum(tickets_redeemed).
    2016-2025 are the complete years. 2015 starts in May and 2026 ends on 2 Oct; leave them out of year-on-year comparisons.
    There is no route, destination, rider type or capacity information.

subway_delays  -- TTC Subway Delay Data, one row per incident
  date      DATE       -- 2025-01-01 to 2026-08-31
  time      TIME       -- use hour(time) for the hour of day
  weekday   VARCHAR    -- 'Monday' ... 'Sunday'
  station   VARCHAR    -- upper case, e.g. 'KIPLING STATION', 'KENNEDY BD STATION'
  code      VARCHAR    -- TTC delay code
  cause     VARCHAR    -- upper-case description of the code, e.g. 'DISORDERLY PATRON'; NULL for unknown codes
  min_delay INTEGER    -- minutes of delay. Many incidents have 0. Count a "delay" only WHERE min_delay > 0.
  min_gap   INTEGER    -- minutes between trains
  bound     VARCHAR    -- direction: N, S, E, W
  line      VARCHAR    -- 'YU' = Line 1 Yonge-University, 'BD' = Line 2 Bloor-Danforth, 'SHP' = Line 4 Sheppard.
                       -- About 2% of rows have combined or misspelt values ('YU/BD', 'YUS', 'SRT', ...): when comparing lines, use WHERE line IN ('YU', 'BD', 'SHP').
  There is no passenger count, cost or weather information.
  vehicle   INTEGER

pet_names  -- Licensed Dog and Cat Names: only the top 200 names per animal per year, so it can't give total pet counts
  animal          VARCHAR  -- 'DOG' or 'CAT'
  year            INTEGER  -- 2020 to 2026
  rank            INTEGER  -- 1 = most popular that year
  name            VARCHAR  -- upper case, e.g. 'LUNA'
  licensed_count  INTEGER  -- licensed animals with that name that year

fire_incidents  -- Fire Incidents: fires Toronto Fire Services attended, one row per fire, 2011-2024
  alarm_time             TIMESTAMP
  incident_type          VARCHAR  -- '01 - Fire', '02 - Explosion ...', '03 - NO LOSS OUTDOOR fire ...'. Outdoor no-loss fires (03) are only recorded from 2018,
                                  -- so for trends across years use WHERE incident_type LIKE '01%'.
  initial_call           VARCHAR  -- what the 911 call said, e.g. 'Vehicle Fire', 'Fire - Residential'
  property_use           VARCHAR  -- coded text, e.g. '323 - Multi-Unit Dwelling - Over 12 Units', '301 - Detached Dwelling', '901 - Automobile'
  ward                   INTEGER  -- 1 to 25
  possible_cause         VARCHAR  -- e.g. '52 - Electrical Failure', '45 - Improperly Discarded', '44 - Unattended', '99 - Undetermined'
  ignition_source, material_first_ignited, area_of_origin, extent_of_fire, building_status  VARCHAR (coded text like the above)
  civilian_casualties, firefighter_casualties, persons_rescued, persons_displaced, responding_personnel  INTEGER
  dollar_loss            BIGINT   -- estimated dollar loss
  response_minutes       DOUBLE   -- alarm to first truck arriving
  smoke_alarm            VARCHAR  -- e.g. '2 - Floor/suite of fire origin: Smoke alarm present and operated', '1 - ...: No smoke alarm'
  sprinkler              VARCHAR
  Labels: strip the code numbers for display, e.g. regexp_replace(possible_cause, '^[0-9]+ - ', '').

fire_calls  -- Fire Services Emergency Incident Basic Detail: EVERY call Toronto Fire responded to (medical, fire, alarms, rescues ...), one row per call, 2018-2024
  alarm_time        TIMESTAMP
  call_type         VARCHAR  -- 'Medical', 'Emergency Fire', 'Vehicle Incident', 'Other Emergency Events', 'Technical Rescue', 'Carbon Monoxide', 'CBRN & Hazardous Materials', 'Non Emergency'
  event_type        VARCHAR  -- more detail, e.g. 'FAHR - Alarm Highrise Residential', 'REE - Rescue - Elevator', 'FIG - Fire - Grass/Rubbish'
  final_type        VARCHAR  -- what it turned out to be, coded text
  call_source       VARCHAR
  alarm_level       VARCHAR
  ward              INTEGER  -- 1 to 25 (0 = unknown)
  response_minutes  DOUBLE   -- alarm to first truck arriving
  persons_rescued   INTEGER

bus_delays  -- TTC Bus Delay Data, one row per incident, 2025-01-01 to 2026-08-31
  date DATE, time TIME, weekday VARCHAR ('Monday' ...),
  route     VARCHAR  -- upper case route, e.g. '52 LAWRENCE WEST', '32 EGLINTON WEST'
  location  VARCHAR  -- where it happened, upper case free text
  code VARCHAR, cause VARCHAR  -- upper-case description, e.g. 'NO OPERATOR AVAILABLE', 'ON DIVERSION', 'OTHER'; NULL for unknown codes
  min_delay INTEGER  -- minutes. Count a "delay" only WHERE min_delay > 0.
  min_gap INTEGER, bound VARCHAR

streetcar_delays  -- TTC Streetcar Delay Data, same columns as bus_delays, 2025-01-01 to 2026-08-31
  route e.g. '504 KING', '501 QUEEN', '505 DUNDAS', '506 CARLTON', '510 SPADINA'

shelter_occupancy  -- Daily Shelter & Overnight Service Occupancy & Capacity: one row per shelter program per night, 2021-01-01 to 2026-10-04
  date            DATE
  organization, shelter_group, location, program  VARCHAR
  sector          VARCHAR  -- 'Families', 'Mixed Adult', 'Men', 'Women', 'Youth'
  program_model   VARCHAR  -- 'Emergency', 'Transitional'
  service_type    VARCHAR  -- 'Shelter', 'Motel/Hotel Shelter', '24-Hour Respite Site', ...
  program_area    VARCHAR  -- 'Base Shelter and Overnight Services System', 'COVID-19 Response', 'Temporary Refugee Response', 'Winter Programs', ...
  capacity_type   VARCHAR  -- 'Bed Based Capacity' or 'Room Based Capacity' (families are usually counted in rooms)
  service_users   INTEGER  -- people staying that night
  beds_available, beds_occupied, rooms_available, rooms_occupied  INTEGER (NULL when the other capacity type applies)
  Notes: people in shelters on a night = sum(service_users) for that date. For a month or year, average the nightly totals:
    SELECT avg(n) FROM (SELECT date, sum(service_users) AS n FROM shelter_occupancy GROUP BY 1). 2026 is a partial year.

dinesafe  -- DineSafe restaurant and food premises inspections, one row per infraction (or one row for an inspection with none), 2023-11 to 2026-10
  establishment_id VARCHAR, establishment VARCHAR (upper case name), address VARCHAR
  inspection_date  DATE
  status           VARCHAR  -- 'Pass', 'Conditional Pass', 'Closed'
  infraction       VARCHAR  -- detailed text, NULL if none
  infraction_category VARCHAR
  severity         VARCHAR  -- 'M - Minor', 'S - Significant', 'C - Crucial', NULL if none
  outcome          VARCHAR  -- e.g. 'Conviction - Fined', mostly NULL
  fine             BIGINT   -- dollars, mostly NULL
  Notes: count inspections as count(DISTINCT establishment_id || inspection_date::VARCHAR), establishments as count(DISTINCT establishment_id).

marriage_licences  -- Marriage Licence Statistics: licences issued per month per civic centre, 2011-01 to 2026-06
  month DATE (first of the month), civic_centre VARCHAR ('TO' = Toronto City Hall, 'NY' = North York, 'SC' = Scarborough, 'ET' = Etobicoke), licences INTEGER

beach_water  -- Toronto Beaches Water Quality: E. coli samples, swimming season (May to September), 2007-2026
  beach VARCHAR (e.g. 'Woodbine Beaches', 'Cherry Beach', 'Kew Balmy Beach'), site VARCHAR (sampling point), date DATE
  ecoli BIGINT  -- E. coli per 100 mL; NULL if not sampled. Several sites per beach per day: average them per beach and day first.
  The City posts a beach as unsafe for swimming when E. coli is above 100.

short_term_rentals  -- Short-term rental registrations (Airbnb-style), current snapshot of registered operators
  property_type VARCHAR ('Condominium', 'Single/Semi-detached House', 'Apartment', 'Townhouse/ Row House', 'Duplex/Triplex/Fourplex'), ward INTEGER, ward_name VARCHAR, postal_code VARCHAR (first 3 characters)

apartment_evaluations  -- RentSafeTO apartment building evaluations (buildings with 3+ storeys and 10+ units), one row per evaluation, 2023-06 to 2026-10
  address VARCHAR, ward INTEGER, ward_name VARCHAR, property_type VARCHAR ('PRIVATE', 'TCHC' = Toronto Community Housing, 'SOCIAL HOUSING'),
  year_built INTEGER, year_evaluated INTEGER, evaluation_date DATE, storeys INTEGER, units INTEGER,
  score DOUBLE  -- 0 to 100, higher is better. A building can be evaluated more than once: for "per building", take its latest evaluation.

ksi_collisions  -- Motor vehicle collisions where someone was killed or seriously injured (KSI), 2006 to 2026-09
  ONE ROW PER PERSON INVOLVED, not per collision. Count collisions with count(DISTINCT collision_id).
  collision_id VARCHAR, collision_time TIMESTAMP
  severity  VARCHAR  -- for the whole collision: 'Fatal Injury', 'Non-Fatal Injury'
  injury    VARCHAR  -- for this person: 'Fatal', 'Major', 'Minor', 'Minimal', 'None'. People killed = count(*) WHERE injury = 'Fatal'.
  road_user VARCHAR  -- 'driver', 'pedestrian', 'passenger', 'cyclist', 'motorcyclist', ...
  age INTEGER, impact_type, light, road_condition, visibility, road_class VARCHAR
  ward_name, neighbourhood, street1, street2 VARCHAR
  pedestrian, cyclist, motorcyclist, aggressive, distracted, red_light, school_child, older_adult, heavy_truck  BOOLEAN  -- collision involved this
  2026 is a partial year.

homeless_deaths_month  -- Deaths of people experiencing homelessness, by month, 2022-2024
  year INTEGER, month VARCHAR ('January' ...), deaths INTEGER
homeless_deaths_cause  -- the same deaths by cause, age group and gender, 2022-2024
  year INTEGER, cause VARCHAR ('Acute Drug Toxicity', 'Cardiovascular Disease', 'Suicide', 'Homicide', 'Unknown', 'Pending', ...),
  age_group VARCHAR ('<20', '20-39', '40-59', '60+', 'Unknown'), gender VARCHAR, deaths INTEGER

library_visits  -- Toronto Public Library visits per branch per year, 2012-2024
  year INTEGER, branch VARCHAR (e.g. 'Toronto Reference Library', 'North York Central Library'), visits BIGINT

street_trees  -- every City-owned tree on a street, current inventory, 688,335 trees
  ward INTEGER, common_name VARCHAR (e.g. 'Maple, Norway', 'Honey locust', 'Oak, red'), botanical_name VARCHAR, trunk_diameter_cm INTEGER, street VARCHAR

building_permits  -- Building permits cleared (closed or finished) since 2017, one row per permit
  permit_type VARCHAR ('Plumbing(PS)', 'Small Residential Projects', 'Mechanical(MS)', 'New Houses', 'Demolition Folder (DM)', ...),
  structure_type, work ('Interior Alterations', 'New Building', ...), status ('Closed', 'Cancelled', ...)  VARCHAR,
  application_date, issued_date, completed_date DATE  -- use issued_date for trends, 2017-2025 are the full years
  current_use, proposed_use VARCHAR, units_created, units_lost INTEGER (dwelling units), est_cost DOUBLE (dollars), postal_area VARCHAR

animal_services  -- Toronto Animal Services service requests and complaints, 2023-2026 (2026 partial)
  year INTEGER, category VARCHAR ('MOBILE RESPONSE SERVICE REQUESTS', 'ENFORCEMENT COMPLAINTS'),
  request_type VARCHAR (upper case, e.g. 'INJURED WILDLIFE', 'CADAVER - WILDLIFE', 'COYOT RESPONSE' = coyote, 'NOISE', 'STRAY DOG RUNNING AT LARGE')

service_requests_311  -- 311 service requests, already COUNTED per day: one row per date + ward + type + status, 2019-01-01 to 2026-08-31
  date DATE, ward VARCHAR (e.g. 'Toronto-Danforth (14)'), division VARCHAR ('Solid Waste Management Services', 'Transportation Services', 'Municipal Licensing & Standards', 'Toronto Water', 'Urban Forestry', ...),
  section VARCHAR, request_type VARCHAR (e.g. 'Road - Pot hole', 'Res / Garbage / Not Picked Up', 'Property Standards', 'Injured - Wildlife', 'Noise'), status VARCHAR,
  requests INTEGER  -- ALWAYS use sum(requests), never count(*).
  Notes: the City RENAMED most request types in 2025 (e.g. 'Road - Pot hole' became 'Road Pothole / Road Damage', 'Residential: Bin: Repair or Replace Lid'
    became 'Residential Bin Lid Damaged', 'Cadaver - Wildlife' became 'Pick up Dead Wildlife'). For a topic across years, match both names with ILIKE
    keywords (e.g. request_type ILIKE '%pot%hole%' OR request_type ILIKE '%pothole%'), or use division, which did not change. Urban Forestry requests stop after 2021.

Writing notes:
- pet_names counts licensed animals with a name in a year, not new registrations.
- ksi_collisions has one row per person: say people or collisions to match the SQL.
- Things these tables don't have, never to be suggested as follow-ups: ferry routes or destinations, passenger counts, costs, weather.
