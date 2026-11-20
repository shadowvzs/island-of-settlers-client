/** Capacity reserved by the wildlife manager for editor-authored individual home positions. */
export const MAX_AUTHORED_ANIMALS = 48;
export const MAX_ANIMAL_STAMP_POPULATION = 16;
export const DEFAULT_AUTHORED_ANIMAL_AGE = .9;

export interface AuthoredAnimal {
  /** Existing rabbit/deer/elk IDs. */
  species: number;
  /** Initial normalized age; omitted legacy records start as adults. */
  age?: number;
  x: number;
  z: number;
}

export const validAuthoredAnimals = (value: unknown, width: number, height: number): value is AuthoredAnimal[] =>
  Array.isArray(value) && value.length <= MAX_AUTHORED_ANIMALS && value.every(animal =>
    animal && typeof animal === "object" && !Array.isArray(animal) &&
    Number.isInteger(animal.species) && animal.species >= 0 && animal.species < 3 &&
    Number.isFinite(animal.x) && Number.isFinite(animal.z) && animal.x >= 0 && animal.z >= 0 &&
    animal.x < width && animal.z < height && (animal.age === undefined ||
      (Number.isFinite(animal.age) && animal.age >= 0 && animal.age <= 1)));
