UPDATE tutors SET persona = jsonb_set(persona, '{voice}', '"Ara"') WHERE persona->>'tutor_name' = 'Aris';
UPDATE tutors SET persona = jsonb_set(persona, '{voice}', '"Sal"') WHERE persona->>'tutor_name' = 'Newton';
UPDATE tutors SET persona = jsonb_set(persona, '{voice}', '"Eve"') WHERE persona->>'tutor_name' = 'Mendi';
UPDATE tutors SET persona = jsonb_set(persona, '{voice}', '"Leo"') WHERE persona->>'tutor_name' = 'Lexi';
UPDATE tutors SET persona = jsonb_set(persona, '{voice}', '"Rex"') WHERE persona->>'tutor_name' = 'Archi';
SELECT persona->>'tutor_name' AS tutor, persona->>'voice' AS voice FROM tutors ORDER BY persona->>'tutor_name';
