# GazeMining: A Dataset of Video and Interaction Recordings on Dynamic Web Pages.
Labels of Visual Change, Segmentation of Videos into Stimulus Shots, and Discovery of Visual Stimuli.

## Author
Raphael Menges

## License
To the extent possible under law, the person who associated CC0 with
this dataset has waived all copyright and related or neighboring rights
to this dataset.

You should have received a copy of the CC0 legalcode along with this
work. If not, see <http://creativecommons.org/publicdomain/zero/1.0/>.

## Version
1.0.2

## Changelog
[1.0.2] Add counts of layer pixels per participant.
[1.0.1] Change to CC0 license.
[1.0.1] Add labels of third annotator "l3".
[1.0.0] Initial release.

## Acknowledgment
We acknowledge the financial support by the Federal Ministry of Education
and Research of Germany under the project number 01IS17095B.

## Recording setup
Recordings have been taken place on 12th March 2019. Gaze data has been recorded
with a Tobii 4C eye tracker with Pro license at 90 Hz. Resolution of the view-
port was set to 1024x768. The display had a size of 24 inches and a resolution of
1680x1050 pixels. We polled the DOM tree every 50 milliseconds for fixed elements.
We recorded the Web browsing of four participants, who followed the protocol
as stored under "Dataset_visual_change/Instructions.doc".

## Description of the dataset
The dataset consists of following three subsets.

### Dataset_visual_change
The recordings of each participant p1-p4 on twelve Web sites are in
the corresponding directories. For each Web site, there are nine to eleven files:
<site>.json:				datacast
<site>.webm:				video recording
<site>.features.csv:		computer-vision features per observation
<site>.features_meta.csv:	meta information about features
<site>.labels-l<X>.csv:		labels of observations
<site>_meta.csv:			meta information about recording
<site>_scroll_cache.csv:	cache of estimated scrolling
<site>_scroll_cache_map.csv:mapping of observations to scroll cache entries
<site>_times.csv:			timestamps of frames in the video recording
<site>_layer_pixels.csv:	first row is the pixel count of root layer, second
							row is pixel count of all fixed elements

### Dataset_stimuli
Stimulus shots and visual stimuli computed with the framework. Value-based,
edge-based, signal-based, and SIFT-based features have been used. The labels
of the first participant's session had been used to train a random forest
classifier with 100 trees for visual change classification, using the named
features. The discovery has been performed on each Web site from the dataset and
the results are placed in the respective directories. Inside each directory,
there is one directory for the detected shots and one for the discovered stimuli.
In the shots directory, there is one overview as <participant>_<site>.csv file.
For each shot, there are four further files:
<participant>_<site>_<shot>.png:		stitched frame of the stimulus shot
<participant>_<site>_<shot>-blind.csv:	frames from animations that are not
										contributing to the stitched frame
<participant>_<site>_<shot>-gaze.csv:	gaze data (in stitched frame space)
<participant>_<site>_<shot>-mouse.csv:	mouse data (in stitched frame space)
The shots have been merged to stimuli, which are placed in the stimuli directory.
The stimuli are grouped per layer (scrollable, fixed elements, etc.) and meta
information is available in <layer_index>-<xpath>-meta.csv files.
Furthermore, there are directories per layer, storing the discovered stimuli.
Each discovered visual stimulus is represented by four files:
<stimulus_id>.png:			stitched frame of the visual stimulus
<stimulus_id>-gaze.csv:		gaze data (in stitched frame space)
<stimulus_id>-mouse.csv:	mouse data (in stitched frame space)
<stimulus_id>-shots.csv:	contained stimulus shots

### Dataset_evaluation
We have performed two evaluations of the visual stimuli discovery. One
computational estimating the quality of stimuli. One case-study of an
expert's task. There are two respective directories with the annotation data.