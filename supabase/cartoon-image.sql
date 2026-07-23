-- Таа — repurpose the "cartoon" category as an image (poster) guessing game.
-- Originally seeded as audio ("Дуугаар нь таа"); the Хүүхэлдэйн кино pack guesses
-- cartoons by their poster image instead. Run once in the Supabase SQL editor,
-- BEFORE ingesting scripts/songs.cartoon.json (the media-type trigger in
-- category-catalog.sql rejects image items while the category is still 'audio').

update public.categories
set media_type = 'image',
    subtitle   = 'Зургаар нь таа'
where slug = 'cartoon';
