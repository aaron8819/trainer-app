// Presentation only: frozen catalog names and authored descriptions remain unchanged.
const titles: Readonly<Record<string, readonly [string, string]>> = {
  't2:chest-supported-machine-row-stack': [
    'Chest-Supported Machine Row (Stack)',
    'Chest-Supported Machine Row',
  ],
  't2:chest-supported-machine-row-plates-per-arm': [
    'Chest-Supported Machine Row (Plates per Arm)',
    'Chest-Supported Machine Row',
  ],
  't2:chest-supported-machine-high-row-stack': [
    'Chest-Supported Machine High Row (Stack)',
    'Chest-Supported Machine High Row',
  ],
  't2:chest-supported-machine-high-row-plates-per-arm': [
    'Chest-Supported Machine High Row (Plates per Arm)',
    'Chest-Supported Machine High Row',
  ],
  't2:smith-machine-bulgarian-split-squat-plates-added': [
    'Smith-Machine Bulgarian Split Squat (Plates Added)',
    'Smith-Machine Bulgarian Split Squat',
  ],
  't2:hack-squat-plates-added': ['Hack Squat (Plates Added)', 'Hack Squat'],
  't2:seated-calf-raise-plates-added': ['Seated Calf Raise (Plates Added)', 'Seated Calf Raise'],
  't2:smith-machine-standing-calf-raise-plates-added': [
    'Smith-Machine Standing Calf Raise (Plates Added)',
    'Smith-Machine Standing Calf Raise',
  ],
  't2:iso-lateral-low-row-plates-per-arm': [
    'Iso-Lateral Low Row (Plates per Arm)',
    'Iso-Lateral Low Row',
  ],
};

export function exerciseTitle(exercise: {
  name: string;
  kind?: string;
  catalogId?: string;
  id?: string;
}): string {
  if (exercise.kind === 'authoredDescription') return exercise.name;
  const alias = titles[exercise.catalogId ?? exercise.id ?? ''];
  return alias?.[0] === exercise.name ? alias[1] : exercise.name;
}
