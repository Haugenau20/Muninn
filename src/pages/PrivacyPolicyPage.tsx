// src/pages/PrivacyPolicyPage.tsx
import React from "react";
import { BarChart3, Database, Trash2 } from "lucide-react";
import Typography from "core/components/Typography";
import Card from "core/components/Card";
import Button from "core/components/Button";
import PageShell from "shared/components/page-shell/PageShell";
import { useNavigation } from "shared/hooks/useNavigation";
import { useAnalyticsConsent } from "shared/hooks/useAnalyticsConsent";
import { INACTIVITY_TIMEOUT_TEXT, REMEMBER_ME_TEXT } from "core/constants/time";
import {
  PRIVACY_CONTROLLER,
  PRIVACY_HOSTING_REGION,
  IMAGE_STORAGE_REGION,
  EXTRACTION_FACTS,
  OPENAI_DPA_ACCEPTED,
  ANALYTICS_FACTS,
} from "core/constants/privacy";
import PrivacyLastUpdated from "./privacy/PrivacyLastUpdated";
import PrivacyDataTable from "./privacy/PrivacyDataTable";
import PrivacySectionNav from "./privacy/PrivacySectionNav";

/**
 * One section of the full policy text.
 *
 * Sections are hairline-separated rather than boxed: the page reserves cards
 * for the three things a reader can act on, so that a box means "there is a
 * button in here" instead of meaning nothing.
 */
const Section: React.FC<{
  id: string;
  title: string;
  children: React.ReactNode;
}> = ({ id, title, children }) => (
  <section
    id={id}
    className="scroll-mt-24 py-6 border-t card-divider first:border-t-0 first:pt-0"
  >
    <Typography variant="h2" className="mb-3 text-xl">
      {title}
    </Typography>
    <div className="space-y-3">{children}</div>
  </section>
);

/**
 * The privacy policy.
 *
 * Ordered so the answers come before the prose: three summary cards, then the
 * at-a-glance table, then the full text beside a sticky anchor list.
 *
 * The frame is `PageShell`'s, at the document width the page already had; the
 * revision date is the page's `actions`, which is what that slot is for. The
 * policy sections stay hairline-separated rather than boxed -- see `Section`
 * below -- so the three cards keep meaning "there is a button in here". Every
 * factual claim below is traceable to code (`core/constants/privacy.ts`),
 * and anything that could not be traced was cut rather than softened.
 */
const PrivacyPolicyPage: React.FC = () => {
  const { navigateToPage } = useNavigation();
  const [analyticsConsent, setAnalyticsConsent] = useAnalyticsConsent();
  const analyticsOn = analyticsConsent === "granted";

  return (
    <PageShell
      title="Privacy"
      subtitle="What Muninn keeps about you, why, and how to get rid of it."
      actions={<PrivacyLastUpdated />}
      maxWidth="max-w-5xl"
    >
      {/* ---- Three summary cards ---- */}
      <div className="grid gap-4 sm:grid-cols-3 mb-8">
        <Card>
          <Card.Content>
            <div className="flex items-center gap-2 mb-2">
              <Database className="w-4 h-4 primary" aria-hidden="true" />
              <Typography variant="h3" className="text-base">
                Who holds your data
              </Typography>
            </div>
            <Typography variant="body-sm" color="secondary">
              {PRIVACY_CONTROLLER.name}, {PRIVACY_CONTROLLER.country}, is
              responsible for it. Stored in Google Firebase, in{" "}
              {PRIVACY_HOSTING_REGION}; pictures in {IMAGE_STORAGE_REGION}.
            </Typography>
            <Button
              variant="link"
              size="sm"
              className="mt-2 px-0"
              onClick={() => navigateToPage(PRIVACY_CONTROLLER.contactPath)}
            >
              Ask a question
            </Button>
          </Card.Content>
        </Card>

        <Card>
          <Card.Content>
            <div className="flex items-center gap-2 mb-2">
              <BarChart3 className="w-4 h-4 primary" aria-hidden="true" />
              <Typography variant="h3" className="text-base">
                No ads, analytics if you agree
              </Typography>
            </div>
            <Typography variant="body-sm" color="secondary">
              No advertising, nothing sold or shared with anyone for their own
              purposes. {ANALYTICS_FACTS.provider} counts visits only if you
              say yes; in this browser it is{" "}
              <strong>{analyticsOn ? "on" : "off"}</strong>.
            </Typography>
            <Button
              variant="link"
              size="sm"
              className="mt-2 px-0"
              onClick={() => setAnalyticsConsent(analyticsOn ? "denied" : "granted")}
            >
              {analyticsOn ? "Turn analytics off" : "Allow analytics"}
            </Button>
          </Card.Content>
        </Card>

        <Card>
          <Card.Content>
            <div className="flex items-center gap-2 mb-2">
              <Trash2 className="w-4 h-4 primary" aria-hidden="true" />
              <Typography variant="h3" className="text-base">
                Delete it yourself
              </Typography>
            </div>
            <Typography variant="body-sm" color="secondary">
              Leaving a group and deleting your account are both buttons on your
              profile. You don't have to ask anyone.
            </Typography>
            <Button
              variant="link"
              size="sm"
              className="mt-2 px-0"
              onClick={() => navigateToPage("/profile")}
            >
              Go to your profile
            </Button>
          </Card.Content>
        </Card>
      </div>

      {/* ---- The at-a-glance table ---- */}
      <div className="mb-12">
        <PrivacyDataTable />
      </div>

      {/* ---- The full text ---- */}
      <div className="lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-10">
        <PrivacySectionNav />

        <div>
          <Section id="your-rights" title="Your rights">
            <Typography>
              You can see what we hold, correct it, take it with you, or delete
              it. Two of those are buttons rather than requests: your profile
              page lets you edit what you have written and delete your account
              outright. For the rest, ask and a person will answer.
            </Typography>
            <Typography>
              You can also object to how we use your data, or ask us to restrict
              it. If you think we have handled your data badly, you can complain
              to Datatilsynet, the Danish data protection authority — you don't
              need to go through us first.
            </Typography>
          </Section>

          <Section id="what-we-collect" title="What we collect">
            <Typography>
              An email address and a username, so you can sign in and so your
              work can be credited to you. Session state, so you stay signed in
              between visits: your session ends after{" "}
              {INACTIVITY_TIMEOUT_TEXT} of inactivity, or lasts{" "}
              {REMEMBER_ME_TEXT} if you asked to be remembered.
            </Typography>
            <Typography>
              If you sign in with Google, Google shares your account's email
              address, name and profile picture with Firebase Authentication,
              which keeps them on your account record. The app itself uses only
              the email address.
            </Typography>
            <Typography>
              Everything you write in a campaign — chapters, quests, NPCs,
              locations, rumours and your own notes — along with who wrote it and
              when. That is the app; there is no version of it that does not
              store what you type into it.
            </Typography>
            <Typography>
              Your place in each campaign's story: the chapter you are on, how
              far into each chapter you have read, and which ones you have
              finished, so the app can take you back there. It is kept for you
              alone, one record per campaign.
            </Typography>
            <Typography>
              Pictures you add to an NPC, a place, your campaign's banner or
              your party's crest. Before a photo leaves your device it is shrunk
              and re-saved, which removes its hidden details — the camera it came
              from, and where the photo was taken. Only the picture itself is
              uploaded.
            </Typography>
            <Typography>
              A screenshot you attach to a message you send us, if you are
              signed in. It is shrunk and stripped the same way, then uploaded
              to a folder that only you can add to and nobody can open from the
              app — not even you. We read it once, to attach it to the email,
              and delete it straight after.
            </Typography>
            <Typography>
              Apart from your place in the story, and the parts of the site
              you visit if you allow analytics (below), we do not record which
              pages you visit or what you click. Session activity is detected
              only to decide whether you are still there.
            </Typography>
          </Section>

          <Section id="groups-and-sharing" title="Groups and sharing">
            <Typography>
              Everything you write in a campaign is visible to the other members
              of that group, credited to the character you were posting as. Your
              private notes are not — they are yours until you share them — and
              nor is your place in the story, which nobody else in the group
              can see.
            </Typography>
            <Typography>
              The person who runs this site can reach everything stored here,
              private notes included, through the tools Google provides for
              running it, as whoever runs a web service can. Nothing in the app
              shows anyone else&apos;s private notes, to us or to anyone.
            </Typography>
            <Typography>
              If you leave a group, or delete your account, the chapters,
              quests, NPCs and locations you wrote stay with the group for the
              rest of the table; your name, your characters, your private notes
              and your place in the story are deleted.
            </Typography>
            <Typography>
              A group&apos;s admin can delete the whole group. That deletes it
              for everyone: every campaign in it and everything written there,
              every member&apos;s private notes and place in the story, and its
              pictures. Members keep their accounts and any other groups they
              are in.
            </Typography>
            <Typography>
              Pictures are shown to the members of the group they belong to.
              Each one is served from a link that is hard to guess, and anyone
              who has its link can open it — the app only ever gives that link
              to members of the group, but a member could pass it on.
            </Typography>
          </Section>

          <Section id="entity-extraction" title="Entity extraction">
            <Typography>
              When you press <strong>Scan note</strong>, the text of that note is
              sent to {EXTRACTION_FACTS.provider} to be read once and returned
              as suggested NPCs, places and quests. It happens only when you
              press that button — never in the background, and never to anything
              you have not asked about.
            </Typography>
            <Typography>
              Only the text of that note leaves the app: not its title, not your
              other notes, and none of your campaign content. The request goes
              through {EXTRACTION_FACTS.product}, whose terms are that your text
              is not used to train their models. It is{" "}
              {EXTRACTION_FACTS.retention}, and it is{" "}
              {EXTRACTION_FACTS.transfer}
              {OPENAI_DPA_ACCEPTED
                ? ", under their data processing addendum and standard contractual clauses."
                : "."}
            </Typography>
            <Typography>
              Scanning is capped at {EXTRACTION_FACTS.caps}, unless raised
              for you on request. Don't paste
              anything into a note that you would not want processed this way.
            </Typography>
          </Section>

          <Section id="analytics" title="Analytics">
            <Typography>
              If you say yes, {ANALYTICS_FACTS.provider} counts visits: which
              part of the site each page belongs to (&quot;Quests&quot;, never
              the quest), your browser, device and screen, your language, and
              your rough location, which Google works out from your network
              address. It is told nothing of what is in your campaigns: not
              the page&apos;s address and not its title, which name records,
              campaigns and the codes in sign-in and invitation links.
            </Typography>
            <Typography>
              To recognise a returning visitor it sets two cookies,{" "}
              <code>_ga</code> and one beginning <code>_ga_</code>, which last{" "}
              {ANALYTICS_FACTS.cookieLifetime}, and Firebase keeps an
              installation id in your browser. Google keeps the visit-level
              data for {ANALYTICS_FACTS.retention}; the totals in its reports
              stay. Google signals and ad personalisation are switched off, so
              none of it is used to advertise to you.
            </Typography>
            <Typography>
              Until you answer, and after you say no, it is not loaded at all.
              You can change your answer in the card at the top of this page;
              saying no deletes the cookies and the installation id from your
              browser. It never runs on test copies of the site.
            </Typography>
          </Section>

          <Section id="device-storage" title="On your device">
            <Typography>
              Your session preferences — whether you asked to be remembered,
              which group you were last looking at, and the address you asked
              for a sign-in link at, until you open it — are kept on your own
              device, in your browser, not on our servers, and so is your
              answer about analytics. Without a yes there are no tracking
              cookies, and there is no advertising either way.
            </Typography>
            <Typography>
              To keep automated abuse away from sign-in and our services,
              Google&apos;s reCAPTCHA checks that requests come from this site
              rather than from a script. It loads from Google on every page and
              keeps a note in your browser.
            </Typography>
            <Typography>
              If you asked to be remembered, the campaign records you have
              opened are also kept in your browser, so pages load without
              fetching everything again. Signing out deletes it. Otherwise
              nothing of your campaigns stays on the device after you close
              the page.
            </Typography>
          </Section>

          <Section id="security" title="Security">
            <Typography>
              There are no passwords. You sign in with a one-time link sent to
              your email, or with your Google account, through Firebase
              Authentication, and accounts can only be created from an
              invitation, into a group or to start one. Access to campaign data is decided by
              rules on the database itself rather than by the app asking
              politely, and everything is encrypted in transit and at rest by
              Google. Sessions time out on their own: after{" "}
              {INACTIVITY_TIMEOUT_TEXT} of inactivity, or after{" "}
              {REMEMBER_ME_TEXT} if you asked to be remembered.
            </Typography>
            <Typography>
              No service on the internet can promise perfect security, and we
              won't. What we can say is which measures are actually in place —
              the ones above — rather than describing an audit programme that
              does not exist.
            </Typography>
          </Section>

          <Section id="retention" title="Retention and deletion">
            <Typography>
              Your account and everything in it stays until you delete it. There
              is a <strong>Delete account</strong> button in the danger zone of
              your profile page; it removes your account, your profile in every
              group you belong to, your usernames, your private notes and your
              place in every story, and it cannot be undone. You do not need to email anyone to make that
              happen.
            </Typography>
            <Typography>
              If you can no longer sign in to press it, ask us through the
              contact form and we will delete it for you, the same way.
            </Typography>
            <Typography>
              The campaign content you wrote stays with the group, so you don't
              take the table's shared history with you when you go. Messages you
              send through the contact form are kept only until your question is
              resolved, and are never used to market anything at you. A
              screenshot you attach is deleted from our storage as soon as the
              email is sent, or after a day if the message never is. To stop
              the form being used to flood us, we note when it was used for an
              hour: against your account if you are signed in, otherwise
              against a hash of your network address, never the address
              itself. That note is deleted within a day of the hour ending.
            </Typography>
          </Section>

          <Section id="legal-basis" title="Legal basis">
            <Typography>
              We process your account details and campaign content to give you
              the service you signed up for — that is <em>performance of a
              contract</em>. Session handling and access control rest on our{" "}
              <em>legitimate interest</em> in keeping accounts secure. Sending a
              note for entity extraction happens on your <em>consent</em>,
              expressed by pressing the button, and you can simply not press it.
              {" "}{ANALYTICS_FACTS.provider} runs on your <em>consent</em> too,
              given or refused when you first visit and changed at any time on
              this page. reCAPTCHA rests on our legitimate interest in keeping
              the service free of abuse.
            </Typography>
            <Typography>
              Data is held in Google Firebase in {PRIVACY_HOSTING_REGION}. Four
              things reach outside the EU: entity extraction, described above;
              pictures, including a screenshot on its way to us, which are
              stored in {IMAGE_STORAGE_REGION} under
              Google's data processing terms for Firebase;{" "}
              {ANALYTICS_FACTS.provider}, if you allow it, which Google can
              process in the United States; and Google's own operation of the
              platform, which can involve support access from other countries.
            </Typography>
          </Section>

          <Section id="changes" title="Changes to this page">
            <Typography>
              When this policy changes, the date at the top changes with it and
              the change is listed under "What changed". The date is written by
              hand for exactly that reason — a page that re-dates itself every
              time you open it records nothing at all.
            </Typography>
          </Section>
        </div>
      </div>
    </PageShell>
  );
};

export default PrivacyPolicyPage;
