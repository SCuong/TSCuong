/** Built-in word lists for the mock data generator (fictional, no real personal data). */

export const FIRST_NAMES = [
  'Olivia', 'Liam', 'Emma', 'Noah', 'Amelia', 'Oliver', 'Sophia', 'Elijah', 'Charlotte', 'James', 'Mia', 'Lucas',
  'Isabella', 'Mateo', 'Ava', 'Ethan', 'Harper', 'Leo', 'Luna', 'Aiden', 'Chloe', 'Kai', 'Nora', 'Ezra', 'Zoe', 'Hugo',
  'Lea', 'Felix', 'Clara', 'Jonas', 'Ingrid', 'Mateus', 'Sofia', 'Diego', 'Valentina', 'Rafael', 'Ana', 'Pablo',
  'Yuki', 'Haruto', 'Sakura', 'Ren', 'Mei', 'Wei', 'Lan', 'Minh', 'Linh', 'An', 'Priya', 'Arjun', 'Aisha', 'Omar',
  'Fatima', 'Yusuf', 'Amara', 'Kwame', 'Zara', 'Ivan', 'Anya', 'Mikhail', 'Elena', 'Nikolai', 'Freya', 'Magnus',
  'Aroha', 'Tane', 'Chiara', 'Luca', 'Ines', 'Tomas', 'Maya', 'Sami', 'Noor', 'Ali', 'Grace', 'Henry', 'Ruby', 'Jack',
];

export const LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Lopez',
  'Wilson', 'Anderson', 'Taylor', 'Thomas', 'Moore', 'Martin', 'Lee', 'Thompson', 'White', 'Harris', 'Clark', 'Lewis',
  'Walker', 'Hall', 'Young', 'King', 'Wright', 'Scott', 'Green', 'Baker', 'Adams', 'Nguyen', 'Tran', 'Pham', 'Le',
  'Kim', 'Park', 'Choi', 'Tanaka', 'Suzuki', 'Sato', 'Wang', 'Li', 'Zhang', 'Chen', 'Patel', 'Sharma', 'Singh',
  'Khan', 'Ahmed', 'Hassan', 'Okafor', 'Mensah', 'Mueller', 'Schmidt', 'Schneider', 'Fischer', 'Rossi', 'Russo',
  'Ferrari', 'Dubois', 'Laurent', 'Moreau', 'Silva', 'Santos', 'Oliveira', 'Ivanov', 'Petrov', 'Novak', 'Larsen',
  'Hansen', 'Johansson', 'Nielsen', "O'Brien", 'Murphy', 'Kelly', 'Walsh', 'Fernandez', 'Costa',
];

/** [city, country] pairs so a row's city and country agree. */
export const PLACES: Array<[string, string]> = [
  ['New York', 'United States'], ['San Francisco', 'United States'], ['Chicago', 'United States'], ['Austin', 'United States'],
  ['Seattle', 'United States'], ['Toronto', 'Canada'], ['Vancouver', 'Canada'], ['Montreal', 'Canada'],
  ['Mexico City', 'Mexico'], ['Guadalajara', 'Mexico'], ['São Paulo', 'Brazil'], ['Rio de Janeiro', 'Brazil'],
  ['Buenos Aires', 'Argentina'], ['Santiago', 'Chile'], ['Bogotá', 'Colombia'], ['Lima', 'Peru'],
  ['London', 'United Kingdom'], ['Manchester', 'United Kingdom'], ['Edinburgh', 'United Kingdom'], ['Dublin', 'Ireland'],
  ['Paris', 'France'], ['Lyon', 'France'], ['Berlin', 'Germany'], ['Munich', 'Germany'], ['Hamburg', 'Germany'],
  ['Amsterdam', 'Netherlands'], ['Rotterdam', 'Netherlands'], ['Brussels', 'Belgium'], ['Zürich', 'Switzerland'],
  ['Vienna', 'Austria'], ['Madrid', 'Spain'], ['Barcelona', 'Spain'], ['Lisbon', 'Portugal'], ['Porto', 'Portugal'],
  ['Rome', 'Italy'], ['Milan', 'Italy'], ['Stockholm', 'Sweden'], ['Oslo', 'Norway'], ['Copenhagen', 'Denmark'],
  ['Helsinki', 'Finland'], ['Warsaw', 'Poland'], ['Prague', 'Czechia'], ['Budapest', 'Hungary'], ['Athens', 'Greece'],
  ['Istanbul', 'Türkiye'], ['Cairo', 'Egypt'], ['Lagos', 'Nigeria'], ['Nairobi', 'Kenya'], ['Accra', 'Ghana'],
  ['Cape Town', 'South Africa'], ['Johannesburg', 'South Africa'], ['Dubai', 'United Arab Emirates'],
  ['Mumbai', 'India'], ['Bengaluru', 'India'], ['Delhi', 'India'], ['Singapore', 'Singapore'],
  ['Kuala Lumpur', 'Malaysia'], ['Bangkok', 'Thailand'], ['Hanoi', 'Vietnam'], ['Ho Chi Minh City', 'Vietnam'],
  ['Da Nang', 'Vietnam'], ['Jakarta', 'Indonesia'], ['Manila', 'Philippines'], ['Seoul', 'South Korea'],
  ['Busan', 'South Korea'], ['Tokyo', 'Japan'], ['Osaka', 'Japan'], ['Kyoto', 'Japan'], ['Shanghai', 'China'],
  ['Shenzhen', 'China'], ['Taipei', 'Taiwan'], ['Sydney', 'Australia'], ['Melbourne', 'Australia'],
  ['Auckland', 'New Zealand'], ['Wellington', 'New Zealand'],
];

export const STREET_NAMES = [
  'Maple', 'Oak', 'Cedar', 'Pine', 'Elm', 'Willow', 'Birch', 'Lake', 'Hill', 'River', 'Park', 'Sunset', 'Harbor',
  'Meadow', 'Forest', 'Spring', 'Church', 'Mill', 'Station', 'Market', 'King', 'Queen', 'Victoria', 'Highland',
  'Orchard', 'Garden', 'Bridge', 'Valley', 'Ridge', 'Chestnut',
];
export const STREET_SUFFIXES = ['Street', 'Avenue', 'Road', 'Lane', 'Drive', 'Court', 'Way', 'Boulevard', 'Place', 'Terrace'];

export const COMPANY_PREFIXES = [
  'Blue', 'Bright', 'North', 'Silver', 'Green', 'Rapid', 'Summit', 'Crystal', 'Iron', 'Golden', 'Red', 'Clear',
  'Quantum', 'Nova', 'Pixel', 'Cloud', 'Stone', 'Swift', 'Urban', 'Vertex', 'Harbor', 'Pioneer', 'Atlas', 'Orbit',
];
export const COMPANY_NOUNS = [
  'Harbor', 'Peak', 'Bridge', 'Leaf', 'River', 'Forge', 'Wave', 'Field', 'Grid', 'Loop', 'Path', 'Signal', 'Spark',
  'Works', 'Stack', 'Beacon', 'Circuit', 'Canyon', 'Point', 'Lane',
];
export const COMPANY_SUFFIXES = ['Inc.', 'LLC', 'Ltd.', 'Group', 'Labs', 'Systems', 'Solutions', 'Technologies', 'Partners', 'Co.'];

export const JOB_LEVELS = ['Junior', 'Senior', 'Lead', 'Principal', 'Staff', 'Associate', 'Chief', 'Head of', ''];
export const JOB_AREAS = [
  'Software', 'Product', 'Data', 'Marketing', 'Sales', 'Finance', 'Operations', 'Design', 'Security', 'Customer',
  'Research', 'Quality', 'Infrastructure', 'Content', 'People',
];
export const JOB_ROLES = [
  'Engineer', 'Manager', 'Analyst', 'Designer', 'Specialist', 'Consultant', 'Architect', 'Coordinator', 'Strategist',
  'Administrator', 'Developer', 'Scientist',
];

export const MOCK_WORDS = [
  'alpha', 'amber', 'anchor', 'apple', 'arrow', 'autumn', 'balance', 'basket', 'beacon', 'breeze', 'bridge', 'canvas',
  'castle', 'cedar', 'circle', 'cloud', 'comet', 'copper', 'coral', 'crystal', 'delta', 'desert', 'echo', 'ember',
  'falcon', 'feather', 'field', 'forest', 'garden', 'glacier', 'harbor', 'horizon', 'island', 'jade', 'journey',
  'lantern', 'maple', 'marble', 'meadow', 'mirror', 'moss', 'nectar', 'ocean', 'orbit', 'pebble', 'pepper', 'pine',
  'planet', 'prairie', 'quartz', 'rain', 'river', 'saffron', 'shadow', 'signal', 'silver', 'sky', 'spark', 'stone',
  'summit', 'thunder', 'timber', 'valley', 'velvet', 'violet', 'willow', 'winter', 'yellow', 'zephyr',
];

/** Reserved example domains (RFC 2606 / RFC 6761) so generated emails never belong to real people. */
export const EMAIL_DOMAINS = ['example.com', 'example.org', 'example.net', 'mail.example', 'test.example'];
export const TLDS_FOR_URLS = ['example.com', 'example.org', 'example.net'];
