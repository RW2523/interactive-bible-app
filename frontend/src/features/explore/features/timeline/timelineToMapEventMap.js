/**
 * Which timeline events (data/explore/bible_timeline_events.json, 583 events) belong to which atlas event
 * (data/explore/bible_events.json, 50 events with a map pin).
 *
 * Curated by passage: each atlas event lists the timeline events that tell the same part of the story. The FIRST id in
 * each list is the one "Open in Timeline" selects. Timeline ids never change, so this is an exact lookup (no guessing
 * from titles, which used to link e.g. "Josiah Celebrates the Passover" to the Ten Plagues).
 */
const MAP_EVENT_TIMELINE_IDS = {
  creation: ['evt_0002_the_creation', 'evt_0003_the_garden_of_eden'],
  fall_of_man: ['evt_0004_the_fall_of_man'],
  cain_and_abel: ['evt_0005_cain_kills_abel'],
  noahs_ark: ['evt_0008_the_great_flood', 'evt_0009_the_flood_subsides', 'evt_0010_covenant_of_the_rainbow'],
  tower_of_babel: ['evt_0013_the_tower_of_babel'],
  call_of_abraham: ['evt_0014_god_sends_abram_to_egypt'],
  abrahamic_covenant: ['evt_0019_god_s_covenant_with_abram'],
  birth_of_isaac: ['evt_0026_isaac_born', 'evt_0023_god_promises_the_birth_of_isaac'],
  abraham_tested_with_isaac: ['evt_0029_the_offering_of_isaac'],
  jacob_receives_blessing: ['evt_0036_jacob_gets_isaac_s_blessing', 'evt_0038_jacob_s_vision_of_a_ladder'],
  jacob_becomes_israel: ['evt_0044_jacob_wrestles_with_god', 'evt_0049_jacob_named_israel'],
  joseph_sold_into_egypt: ['evt_0053_joseph_sold_into_slavery', 'evt_0052_joseph_s_dreams_and_betrayal'],
  joseph_rises_to_power: ['evt_0060_joseph_put_in_charge', 'evt_0055_joseph_prospers_under_potiphar', 'evt_0059_joseph_interprets_pharaoh_s_dreams', 'evt_0067_joseph_reveals_his_identity'],
  israelites_enslaved: ['evt_0077_israelites_oppressed_by_new_king', 'evt_0081_israelites_groan_in_slavery'],
  burning_bush: ['evt_0082_moses_sent_to_deliver_israel'],
  ten_plagues_passover: ['evt_0083_the_ten_plagues_on_egypt'],
  red_sea_crossing: ['evt_0084_the_exodus_begins'],
  ten_commandments: ['evt_0086_moses_receives_the_commandments', 'evt_0085_the_isreaelites_at_mount_sinai'],
  golden_calf_tabernacle: ['evt_0089_the_golden_calf_and_moses_anger'],
  spies_enter_canaan: ['evt_0101_the_twelve_spies', 'evt_0102_people_murmur_at_the_spies_report'],
  joshua_crosses_jordan: ['evt_0130_the_israelites_cross_the_jordan'],
  fall_of_jericho: ['evt_0131_conquer_of_jericho_and_ai'],
  land_divided: ['evt_0135_land_allotted_among_the_tribes'],
  judges_period_begins: ['evt_0143_israel_rebuked_and_defeated'],
  deborah_and_barak: ['evt_0147_deborah_and_barak', 'evt_0148_the_song_of_deborah_and_barak'],
  gideon_defeats_midian: ['evt_0149_gideon_and_the_midianites'],
  samson_and_philistines: ['evt_0160_samson_s_marriage_and_riddle', 'evt_0161_samson_burns_the_philistine_crops', 'evt_0162_samson_and_delilah'],
  ruth_and_boaz: ['evt_0150_naomi_ruth_and_boaz'],
  samuel_called: ['evt_0163_battle_of_shiloh', 'evt_0155_birth_of_samuel'],
  saul_first_king: ['evt_0168_saul_becomes_king'],
  david_and_goliath: ['evt_0174_david_kills_goliath'],
  david_king_jerusalem: ['evt_0203_david_reigns_over_all_israel', 'evt_0196_david_made_king_over_judah'],
  davidic_covenant: ['evt_0208_david_plans_a_temple', 'evt_0215_david_purposes_to_build_a_temple'],
  solomon_builds_temple: ['evt_0261_the_building_of_solomon_s_temple', 'evt_0266_solomon_builds_the_temple_in_jerusalem'],
  kingdom_divides: ['evt_0283_the_kingdom_is_divided'],
  elijah_mount_carmel: ['evt_0301_elijah_on_mount_carmel'],
  elishas_ministry: ['evt_0315_elisha_succeeds_elijah', 'evt_0319_the_healing_of_naaman'],
  assyria_conquers_israel: ['evt_0362_israel_led_into_captivity', 'evt_0361_hoshea_the_last_king_of_israel'],
  hezekiah_jerusalem_delivered: ['evt_0370_sennacherib_threatens_jerusalem', 'evt_0372_hezekiah_s_prayer'],
  josiahs_reform: ['evt_0383_hilkiah_finds_the_lost_book_of_the_law', 'evt_0375_josiah_s_good_reign'],
  babylon_destroys_jerusalem: ['evt_0410_the_fall_of_jerusalem', 'evt_0405_siege_of_jerusalem_begins'],
  daniel_in_babylon: ['evt_0389_daniel_refuses_the_king_s_portion', 'evt_0427_daniel_survives_the_lions_den'],
  esther_saves_jews: ['evt_0445_esther_becomes_queen', 'evt_0449_esther_prepares_a_banquet', 'evt_0452_xerxes_edict_on_behalf_of_esther_and_jews'],
  return_from_exile: ['evt_0435_the_exiles_return', 'evt_0434_the_proclamation_of_cyrus', 'evt_0443_completion_and_dedication_of_the_temple'],
  nehemiah_rebuilds_walls: ['evt_0461_artaxerxes_sends_nehemiah_to_jerusalem', 'evt_0466_completion_of_the_wall'],
  john_baptist_prepares_way: ['evt_0482_john_the_baptist_prepares_the_way'],
  birth_of_jesus: ['evt_0476_birth_of_jesus'],
  baptism_temptation_jesus: ['evt_0483_the_baptism_of_jesus', 'evt_0484_temptation_of_jesus'],
  sermon_on_mount: ['evt_0489_sermon_on_the_mount'],
  crucifixion_resurrection: ['evt_0521_jesus_betrayal_trial_crucifixion', 'evt_0522_jesus_resurrection']
};

const TIMELINE_TO_MAP = new Map();
for (const [mapId, ids] of Object.entries(MAP_EVENT_TIMELINE_IDS)) {
  for (const id of ids) TIMELINE_TO_MAP.set(id, mapId);
}

/**
 * @param {string} timelineId
 * @returns {string|null} the atlas event id, when this timeline event has a map pin
 */
export function getMapEventIdForTimelineEvent(timelineId) {
  return TIMELINE_TO_MAP.get(timelineId) || null;
}

/**
 * @param {string} mapEventId
 * @returns {string|null} the main timeline event for an atlas event
 */
export function getTimelineIdForMapEvent(mapEventId) {
  return MAP_EVENT_TIMELINE_IDS[mapEventId]?.[0] || null;
}

export { MAP_EVENT_TIMELINE_IDS };
