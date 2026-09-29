export const SAMPLE_CSV = `id,name,email,city,signup_date,plan,monthly_spend,active
1,Ada Lovelace,ada@example.com,London,2024-01-15,pro,49.00,true
2,Alan Turing,alan@example.com,Manchester,2024-02-03,free,0,true
3,Grace Hopper,grace@example.com,"Arlington, VA",2023-11-28,team,129.50,true
4,Linus Torvalds,linus@example.com,Portland,2024-03-09,pro,49.00,false
5,Margaret Hamilton,margaret@example.com,Boston,2023-09-17,team,129.50,true
6,Zoë Martín,zoe@example.com,Sevilla,2024-04-22,free,0,true
7,Katherine Johnson,katherine@example.com,Hampton,2024-01-30,pro,49.00,true
8,"O'Brien, Dennis",dennis@example.com,Dublin,,free,,false
9,山田 花子,hanako@example.com,東京,2024-05-06,pro,49.00,true
10,Ada Lovelace,ada@example.com,London,2024-01-15,pro,49.00,true`;

export const SAMPLE_DUPES = `email,name,team
ada@example.com,Ada Lovelace,Engineering
alan@example.com,Alan Turing,Research
ADA@example.com ,Ada L.,Engineering
grace@example.com,Grace Hopper,Navy
alan@example.com,Alan Turing,Research
grace@example.com,Grace B. Hopper,Navy
linus@example.com,Linus Torvalds,Kernel`;

export const SAMPLE_JSON = JSON.stringify(
  [
    { id: 1, name: 'Ada Lovelace', contact: { email: 'ada@example.com', city: 'London' }, tags: ['math', 'poetry'], active: true },
    { id: 2, name: 'Alan Turing', contact: { email: 'alan@example.com', city: 'Manchester' }, tags: ['logic'], active: true },
    {
      id: 3,
      name: 'Grace Hopper',
      contact: { email: 'grace@example.com', city: 'Arlington, VA' },
      tags: [],
      active: false,
      rank: 'Rear Admiral',
    },
  ],
  null,
  2,
);
