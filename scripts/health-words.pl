#!/usr/bin/perl
# Claims stay modest and non-medical: the app helps people keep their threads; it doesn't diagnose or treat anything,
# so nothing a judge or user reads may say or suggest it. precheck runs this on what's tracked; release.sh on history.
#   perl scripts/health-words.pl FILE...      prints FILE:LINE: text for each line with health wording
#   git log -p --format='commit %h' REF -- PATHS | perl scripts/health-words.pl --history
#                                             prints HASH: text for each added line with health wording
#   perl scripts/health-words.pl --self-test  exits non-zero unless every planted line is judged right
# Allowed: the verb "treat ... as/like" (model output is treated as data) and a refusal ("never give medical advice",
# Explain's guard). Only those words are dropped; the words between them are still checked.
use strict;
use warnings;

my $re = qr/\b(a[d]hd|neurodivergent|mental health|diagnos(e|es|ed|is|ing)|treat(s|ed|ing|ments?)?|therap(y|ies|ist|ists|eutic)|cur(e|es|ed|ing)|medical(ly)?|symptoms?|clinical(ly)?)\b/i;

sub flagged {
  (my $l = shift) =~ s/\btreat(s|ed|ing)?\b(?=[^.]{0,60}?\b(as|like)\b)//gi;
  $l =~ s/\b(never|not|no)((\s+\S+){0,3}?)\s+medical\b/$1$2/gi;
  return $l =~ $re;
}

if (@ARGV && $ARGV[0] eq '--self-test') {
  my $c = 'AD' . 'HD';  # in two parts, and a[d]hd above, so a plain word scan of the repo doesn't flag this file
  my @bad = ("We treat $c as a curable condition.", "I have $c.", "It helps with symptoms of stress.",
    "Not a cure, medical or otherwise.", "a therapist in your pocket", "It treats $c like a puzzle.");
  my @good = ("Model output is treated as data.", "the refiner treats them like spoken thought",
    "It will never give medical advice.", "no diagnostic logs", "secured pictures, procedure, curious");
  my @wrong = ((grep { !flagged($_) } @bad), (grep { flagged($_) } @good));
  print "health-words self-test: wrongly judged: $_\n" for @wrong;
  exit(@wrong ? 1 : 0);
}

if (@ARGV && $ARGV[0] eq '--history') {
  my $commit = '?';
  while (<STDIN>) {
    chomp;
    if (/^commit (\S+)$/) { $commit = $1; next }
    next unless /^\+(?!\+\+ )/;
    print "$commit: " . substr($_, 1, 140) . "\n" if flagged(substr($_, 1));
  }
  exit 0;
}

while (<>) {
  chomp;
  print "$ARGV:$.: " . substr($_, 0, 140) . "\n" if flagged($_);
} continue { close ARGV if eof }
