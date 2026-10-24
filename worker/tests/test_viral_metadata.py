import unittest

from pipeline.viral_metadata import generate_viral_metadata, _heuristic_payload


class ViralMetadataTests(unittest.TestCase):
    def test_heuristic_has_all_platforms_and_title_options(self):
        payload = _heuristic_payload(
            transcript="Focus compounds when you ship daily shorts for your audience.",
            clip_title="Focus compounds",
            language="en",
            source_channel="CreatorX",
        )
        self.assertIn("youtube", payload)
        self.assertIn("tiktok", payload)
        self.assertIn("instagram", payload)
        self.assertEqual(len(payload["title_options"]), 3)
        angles = {o["angle"] for o in payload["title_options"]}
        self.assertEqual(angles, {"curiosity", "emotion", "event"})
        self.assertTrue(payload["youtube"]["title"])
        self.assertTrue(payload["moment_summary"])

    def test_speed_norway_police_titles_not_dialogue(self):
        payload = _heuristic_payload(
            transcript=(
                "oh my God bro Chad I'm so sorry Chad I'm genely sorry Norway has been "
                "the worst country yo yeah I'm calling the police I'm actually on hello "
                "excuse me I am a YouTuber"
            ),
            clip_title="way we just came for stay oh my God bro Chad I'm so sorry…",
            language="en",
            source_title="irl stream in Norway",
            source_channel="IShowSpeed",
        )
        title = payload["youtube"]["title"].lower()
        joined = " ".join(o["title"] for o in payload["title_options"]).lower()
        self.assertIn("ishowspeed", title)
        self.assertIn("police", joined)
        self.assertNotIn("i'm so sorry chad", title)
        self.assertNotIn("swatted", joined)

    def test_does_not_invent_swatting(self):
        payload = _heuristic_payload(
            transcript="I'm calling the police right now chat",
            clip_title="calling police",
            language="en",
            source_title="irl stream in Norway",
            source_channel="IShowSpeed",
        )
        blob = str(payload).lower()
        self.assertIn("police", blob)
        self.assertNotIn("swatted", blob)

    def test_generate_falls_back_to_heuristic(self):
        payload = generate_viral_metadata(
            transcript="Hinglish tip: roz thoda improve karo and stay consistent.",
            clip_title="Roz thoda improve",
            language="hinglish",
        )
        self.assertEqual(payload["language"], "hinglish")
        tags = " ".join(payload["youtube"]["hashtags"]).lower()
        self.assertIn("hinglish", tags)

    def test_rejects_dialogue_dump_titles(self):
        payload = _heuristic_payload(
            transcript="A calm tip about saving money each month.",
            clip_title="You won't believe this money tip!!!",
            language="en",
            source_channel="MoneyTalks",
        )
        self.assertNotIn("you won't believe", payload["youtube"]["title"].lower())


if __name__ == "__main__":
    unittest.main()
